const winston = require('winston');		// use config from root instance
const net = require('net')
let cbusLib = require('cbuslibrary')
const EventEmitter = require('events').EventEmitter;
const utils = require('./../VLCB-server/utilities.js');
const { isUndefined } = require('util');


function pad(num, len) { //add zero's to ensure hex values have correct number of characters
    let padded = "00000000" + num;
    return padded.substr(-len);
}

function decToHex(num, len) {
    return parseInt(num).toString(16).toUpperCase().padStart(len, '0');
}

const name = 'mergAdminNode'

class cbusAdmin extends EventEmitter {
    constructor(config) {
        super();
        winston.info({message: `mergAdminNode: Constructor`});
        this.config = config
        this.nodeConfig = {}
        this.nodeDescriptors = {}
        const merg = config.readMergConfig()
        this.merg = merg
        const Service_Definitions = config.readServiceDefinitions()
        this.ServiceDefs = Service_Definitions
        this.pr1 = 2
        this.pr2 = 3
        this.canId = 60
        this.nodeConfig.nodes = {}
        this.nodeConfig.events = {}
        this.cbusErrors = {}
        this.cbusNoSupport = {}
        this.dccSessions = {}
        this.heartbeats = {}
        this.saveConfig()
        this.nodes_EventsNeedRefreshing = {}
        this.nodes_EventVariablesNeedRefreshing = {}
        this.nodeNumberInLearnMode = null

        const outHeader = ((((this.pr1 * 4) + this.pr2) * 128) + this.canId) << 5
        this.header = ':S' + outHeader.toString(16).toUpperCase() + 'N'
        this.client = new net.Socket()
        this.client.connect(config.getJsonServerPort(), config.getServerAddress(), function () {
            winston.info({message: `mergAdminNode: Connected - ${config.getServerAddress()} on ${config.getJsonServerPort()}`});
        })

        //
        this.client.on('data', async function (data) { //Receives packets from network and process individual Messages
            //const outMsg = data.toString().split(";")
            let indata = data.toString().replace(/}{/g, "}|{")
            //winston.info({message: `mergAdminNode: CBUS Receive <<<  ${indata}`})
            const outMsg = indata.toString().split("|")
            //const outMsg = JSON.parse(data)
            //winston.info({message: `mergAdminNode: Split <<<  ${outMsg.length}`})
            for (let i = 0; i < outMsg.length; i++) {

                //let cbusMsg = cbusLib.decode(outMsg[i].concat(";"))     // replace terminator removed by 'split' method
                winston.debug({message: `mergAdminNode: CBUS Receive <<<  ${outMsg[i]}`})
                var msg = JSON.parse(outMsg[i])
                this.emit('cbusTraffic', {direction: 'In', json: msg});
                if (this.isMessageValid(msg)){
                  this.action_message(msg)
                }
            }
        }.bind(this))

        this.client.on('error', (err) => {
            winston.debug({message: 'mergAdminNode: TCP ERROR ${err.code}'});
        })

        //
        this.client.on('close', function () {
            winston.debug({message: 'mergAdminNode: Connection Closed'});
            setTimeout(() => {
                this.client.connect(config.getJsonServerPort(), config.getServerAddress(), function () {
                    winston.debug({message: 'mergAdminNode: Client ReConnected'});
                })
            }, 1000)
        }.bind(this))

        //
        this.actions = { //actions when Opcodes are received
            '00': async (cbusMsg) => { // ACK
                winston.info({message: "mergAdminNode: ACK (00) : No Action"});
            },
            '21': async (cbusMsg) => { // KLOC
                winston.info({message: `mergAdminNode: Session Cleared : ${cbusMsg.session}`});
                let ref = cbusMsg.opCode
                let session = cbusMsg.session
                if (session in this.dccSessions) {
                    this.dccSessions[session].status = 'In Active'
                } else {
                    winston.debug({message: `mergAdminNode: Session ${session} does not exist - adding`});
                    this.dccSessions[session] = {}
                    this.dccSessions[session].count = 1
                    this.dccSessions[session].status = 'In Active'
                    await this.cbusSend(this.QLOC(session))
                }
                this.emit('dccSessions', this.dccSessions)
            },
            '23': async (cbusMsg) => { // DKEEP
                //winston.debug({message: `mergAdminNode: Session Keep Alive : ${cbusMsg.session}`});
                let ref = cbusMsg.opCode
                let session = cbusMsg.session

                if (session in this.dccSessions) {
                    this.dccSessions[session].count += 1
                    this.dccSessions[session].status = 'Active'
                } else {

                    winston.debug({message: `mergAdminNode: Session ${session} does not exist - adding`});

                    this.dccSessions[session] = {}
                    this.dccSessions[session].count = 1
                    this.dccSessions[session].status = 'Active'
                    await this.cbusSend(this.QLOC(session))
                }
                this.emit('dccSessions', this.dccSessions)
            },

            '47': async (cbusMsg) => { // DSPD
                let session = cbusMsg.session
                let speed = cbusMsg.speed
                let direction = cbusMsg.direction
                winston.info({message: `mergAdminNode: (47) DCC Speed Change : ${session} : ${direction} : ${speed}`});

                if (!(session in this.dccSessions)) {
                    this.dccSessions[session] = {}
                    this.dccSessions[session].count = 0
                }

                this.dccSessions[session].direction = direction
                this.dccSessions[session].speed = speed
                this.emit('dccSessions', this.dccSessions)
            },
            '50': async (cbusMsg) => {// RQNN -  Node Number
              winston.debug({message: "mergAdminNode: RQNN (50) : " + cbusMsg.text});
              this.emit('requestNodeNumber', cbusMsg.nodeNumber)
            },
            '52': async (cbusMsg) => {
              // NNACK - acknowledge for set node number
                winston.debug({message: "mergAdminNode: NNACK (59) : " + cbusMsg.text});
                this.query_all_nodes()   // force refresh of nodes
            },
            '59': async (cbusMsg) => {
                winston.debug({message: "mergAdminNode: WRACK (59) : " + cbusMsg.text});
                this.process_WRACK(cbusMsg.nodeNumber)
            },
            '60': async (cbusMsg) => {
                let session = cbusMsg.session
                if (!(session in this.dccSessions)) {
                    this.dccSessions[session] = {}
                    this.dccSessions[session].count = 0
                }
                let functionRange = cbusMsg.Fn1
                let dccNMRA = cbusMsg.Fn2
                let func = `F${functionRange}`
                this.dccSessions[session][func] = dccNMRA
                let functionArray = []
                if (this.dccSessions[session].F1 & 1) functionArray.push(1)
                if (this.dccSessions[session].F1 & 2) functionArray.push(2)
                if (this.dccSessions[session].F1 & 4) functionArray.push(3)
                if (this.dccSessions[session].F1 & 8) functionArray.push(4)
                if (this.dccSessions[session].F2 & 1) functionArray.push(5)
                if (this.dccSessions[session].F2 & 2) functionArray.push(6)
                if (this.dccSessions[session].F2 & 4) functionArray.push(7)
                if (this.dccSessions[session].F2 & 8) functionArray.push(8)
                if (this.dccSessions[session].F3 & 1) functionArray.push(9)
                if (this.dccSessions[session].F3 & 2) functionArray.push(10)
                if (this.dccSessions[session].F3 & 4) functionArray.push(11)
                if (this.dccSessions[session].F3 & 8) functionArray.push(12)
                if (this.dccSessions[session].F4 & 1) functionArray.push(13)
                if (this.dccSessions[session].F4 & 2) functionArray.push(14)
                if (this.dccSessions[session].F4 & 4) functionArray.push(15)
                if (this.dccSessions[session].F4 & 8) functionArray.push(16)
                if (this.dccSessions[session].F4 & 16) functionArray.push(17)
                if (this.dccSessions[session].F4 & 32) functionArray.push(18)
                if (this.dccSessions[session].F4 & 64) functionArray.push(19)
                if (this.dccSessions[session].F4 & 128) functionArray.push(20)
                if (this.dccSessions[session].F5 & 1) functionArray.push(21)
                if (this.dccSessions[session].F5 & 2) functionArray.push(22)
                if (this.dccSessions[session].F5 & 4) functionArray.push(23)
                if (this.dccSessions[session].F5 & 8) functionArray.push(24)
                if (this.dccSessions[session].F5 & 16) functionArray.push(25)
                if (this.dccSessions[session].F5 & 32) functionArray.push(26)
                if (this.dccSessions[session].F5 & 64) functionArray.push(27)
                if (this.dccSessions[session].F5 & 128) functionArray.push(28)
                this.dccSessions[session].functions = functionArray

                winston.debug({message: `mergAdminNode: DCC Set Engine Function : ${cbusMsg.session} ${functionRange} ${dccNMRA} : ${functionArray}`});
                this.emit('dccSessions', this.dccSessions)
            },
            '63': async (cbusMsg) => {// ERR - dcc error
                //winston.debug({message: `mergAdminNode: DCC ERROR Node ${msg.nodeNumber()} Error ${msg.errorId()}`});
                let output = {}
                output['type'] = 'DCC'
                output['Error'] = cbusMsg.errorNumber
                output['Message'] = this.merg.dccErrors[cbusMsg.errorNumber]
                output['data'] = decToHex(cbusMsg.data1, 2) + decToHex(cbusMsg.data2, 2)
                this.emit('dccError', output)
            },
            '6F': async (cbusMsg) => {// CMDERR - Cbus Error
                let ref = cbusMsg.nodeNumber.toString() + '-' + cbusMsg.errorNumber.toString()
                if (ref in this.cbusErrors) {
                    this.cbusErrors[ref].count += 1
                } else {
                    let output = {}
                    output['eventIdentifier'] = ref
                    output['type'] = 'CBUS'
                    output['Error'] = cbusMsg.errorNumber
                    output['Message'] = this.merg.cbusErrors[cbusMsg.errorNumber]
                    output['node'] = cbusMsg.nodeNumber
                    output['count'] = 1
                    this.cbusErrors[ref] = output
                }
                this.emit('cbusError', this.cbusErrors)
            },
            '74': async (cbusMsg) => { // NUMEV
                //winston.info({message: 'mergAdminNode: 74: ' + JSON.stringify(this.nodeConfig.nodes[cbusMsg.nodeNumber])})
                if (this.nodeConfig.nodes[cbusMsg.nodeNumber].eventCount != null) {
                    if (this.nodeConfig.nodes[cbusMsg.nodeNumber].eventCount != cbusMsg.eventCount) {
                        this.nodeConfig.nodes[cbusMsg.nodeNumber].eventCount = cbusMsg.eventCount
                        this.saveNode(cbusMsg.nodeNumber)
                    } else {
                        winston.debug({message: `mergAdminNode:  NUMEV: EvCount value has not changed`});
                    }
                } else {
                    this.nodeConfig.nodes[cbusMsg.nodeNumber].eventCount = cbusMsg.eventCount
                    this.saveNode(cbusMsg.nodeNumber)
                }
                //winston.info({message: 'mergAdminNode:  NUMEV: ' + JSON.stringify(this.nodeConfig.nodes[cbusMsg.nodeNumber])});
            },
            '90': async (cbusMsg) => {//Accessory On Long Event
                //winston.info({message: `mergAdminNode:  90 recieved`})
                this.eventSend(cbusMsg, 'on', 'long')
            },
            '91': async (cbusMsg) => {//Accessory Off Long Event
                //winston.info({message: `mergAdminNode: 91 recieved`})
                this.eventSend(cbusMsg, 'off', 'long')
            },
            '97': async (cbusMsg) => { // NVANS - Receive Node Variable Value
                if (this.nodeConfig.nodes[cbusMsg.nodeNumber].nodeVariables[cbusMsg.nodeVariableIndex] != null) {
                    if (this.nodeConfig.nodes[cbusMsg.nodeNumber].nodeVariables[cbusMsg.nodeVariableIndex] != cbusMsg.nodeVariableValue) {
                        //winston.info({message: `mergAdminNode: Variable ${cbusMsg.nodeVariableIndex} value has changed`});
                        this.nodeConfig.nodes[cbusMsg.nodeNumber].nodeVariables[cbusMsg.nodeVariableIndex] = cbusMsg.nodeVariableValue
                        this.saveNode(cbusMsg.nodeNumber)
                    } else {
                        //winston.info({message: `mergAdminNode: Variable ${cbusMsg.nodeVariableIndex} value has not changed`});
                    }
                } else {
                    //winston.info({message: `mergAdminNode: Variable ${cbusMsg.nodeVariableIndex} value does not exist in config`});
                    this.nodeConfig.nodes[cbusMsg.nodeNumber].nodeVariables[cbusMsg.nodeVariableIndex] = cbusMsg.nodeVariableValue
                    this.saveNode(cbusMsg.nodeNumber)
                }
            },
            '98': async (cbusMsg) => {//Accessory On Short Event
                this.eventSend(cbusMsg, 'on', 'short')
            },
            '99': async (cbusMsg) => {//Accessory Off Short Event
                this.eventSend(cbusMsg, 'off', 'short')
            },
            '9B': async (cbusMsg) => {//PARAN Parameter readback by Index
                let saveConfigNeeded = false
                if (cbusMsg.parameterIndex == 1) {
                    if (this.nodeConfig.nodes[cbusMsg.nodeNumber].moduleManufacturerName != merg.moduleManufacturerName[cbusMsg.parameterValue]) {
                        this.nodeConfig.nodes[cbusMsg.nodeNumber].moduleManufacturerName = merg.moduleManufacturerName[cbusMsg.parameterValue]
                        saveConfigNeeded = true
                    }
                }
                if (cbusMsg.parameterIndex == 9) {
                    if (this.nodeConfig.nodes[cbusMsg.nodeNumber].cpuName != merg.cpuName[cbusMsg.parameterValue]) {
                        this.nodeConfig.nodes[cbusMsg.nodeNumber].cpuName = merg.cpuName[cbusMsg.parameterValue]
                        saveConfigNeeded = true
                    }
                }
                if (cbusMsg.parameterIndex == 10) {
                    if (this.nodeConfig.nodes[cbusMsg.nodeNumber].interfaceName != merg.interfaceName[cbusMsg.parameterValue]) {
                        this.nodeConfig.nodes[cbusMsg.nodeNumber].interfaceName = merg.interfaceName[cbusMsg.parameterValue]
                        saveConfigNeeded = true
                    }
                }
                if (cbusMsg.parameterIndex == 19) {
                    if (this.nodeConfig.nodes[cbusMsg.nodeNumber].cpuManufacturerName != merg.cpuManufacturerName[cbusMsg.parameterValue]) {
                        this.nodeConfig.nodes[cbusMsg.nodeNumber].cpuManufacturerName = merg.cpuManufacturerName[cbusMsg.parameterValue]
                        saveConfigNeeded = true
                    }
                }
                if (this.nodeConfig.nodes[cbusMsg.nodeNumber].parameters[cbusMsg.parameterIndex] !== null) {
                    if (this.nodeConfig.nodes[cbusMsg.nodeNumber].parameters[cbusMsg.parameterIndex] != cbusMsg.parameterValue) {
                        winston.debug({message: `mergAdminNode: Parameter ${cbusMsg.parameterIndex} value has changed`});
                        this.nodeConfig.nodes[cbusMsg.nodeNumber].parameters[cbusMsg.parameterIndex] = cbusMsg.parameterValue
                        saveConfigNeeded = true
                    } else {
                        winston.info({message: `mergAdminNode: Parameter ${cbusMsg.parameterIndex} value has not changed`});
                    }
                } else {
                    winston.info({message: `mergAdminNode: Parameter ${cbusMsg.parameterIndex} value does not exist in config`});
                    this.nodeConfig.nodes[cbusMsg.nodeNumber].parameters[cbusMsg.parameterIndex] = cbusMsg.parameterValue
                    saveConfigNeeded = true
                }
                // ok, save the config if needed
                if (saveConfigNeeded == true) {
                    this.saveNode(cbusMsg.nodeNumber)
                }
            },
            'AB': async (cbusMsg) => {//Heartbeat
                winston.debug({message: `mergAdminNode: Heartbeat ${cbusMsg.nodeNumber} ${Date.now()}`})
                this.heartbeats[cbusMsg.nodeNumber] = Date.now()
            },
            'AC': async (cbusMsg) => {//Service Discovery
                winston.info({message: `mergAdminNode: SD ${cbusMsg.nodeNumber} ${cbusMsg.text}`})
                const ref = cbusMsg.nodeNumber
                if (cbusMsg.ServiceIndex > 0) {
                  // all valid service indexes start from 1 - service index 0 returns count of services
                  if (ref in this.nodeConfig.nodes) {
                    if (this.nodeConfig.nodes[ref]["services"]) {
                      let output = {
                          "ServiceIndex": cbusMsg.ServiceIndex,
                          "ServiceType": cbusMsg.ServiceType,
                          "ServiceVersion": cbusMsg.ServiceVersion,
                          "diagnostics": {}
                      }
                      if (this.ServiceDefs[cbusMsg.ServiceType]) {
                        output["ServiceName"] = this.ServiceDefs[cbusMsg.ServiceType]['name']
                      }
                      else {
                        output["ServiceName"] = "service type not found in ServiceDefs"
                      }
                      this.nodeConfig.nodes[ref]["services"][cbusMsg.ServiceIndex] = output
                      this.saveNode(cbusMsg.nodeNumber)
                    }
                    else {
                          winston.warn({message: `mergAdminNode - SD: node config services does not exist for node ${cbusMsg.nodeNumber}`});
                    }
                  }
                  else {
                          winston.warn({message: `mergAdminNode - SD: node config does not exist for node ${cbusMsg.nodeNumber}`});
                  }
                }
            },
            'AF': async (cbusMsg) => {//GRSP
                winston.debug({message: `mergAdminNode: GRSP ` + cbusMsg.text})
                await this.process_GRSP(cbusMsg)
            },
            'B0': async (cbusMsg) => {//Accessory On Long Event 1
                this.eventSend(cbusMsg, 'on', 'long')
            },
            'B1': async (cbusMsg) => {//Accessory Off Long Event 1
                this.eventSend(cbusMsg, 'off', 'long')
            },
            'B5': async (cbusMsg) => {// NEVAL -Read of EV value Response REVAL
              this.storeEventVariableByIndex(cbusMsg.nodeNumber, cbusMsg.eventIndex, cbusMsg.eventVariableIndex, cbusMsg.eventVariableValue)
                if (this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEvents[cbusMsg.eventIndex] != null) {
                    if (this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEvents[cbusMsg.eventIndex].variables[cbusMsg.eventVariableIndex] != null) {
                        if (this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEvents[cbusMsg.eventIndex].variables[cbusMsg.eventVariableIndex] != cbusMsg.eventVariableValue) {
                            winston.debug({message: `mergAdminNode: Event Variable ${cbusMsg.variable} Value has Changed `});
                            this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEvents[cbusMsg.eventIndex].variables[cbusMsg.eventVariableIndex] = cbusMsg.eventVariableValue
                            this.saveNode(cbusMsg.nodeNumber)
                        } else {
                            winston.debug({message: `mergAdminNode: NEVAL: Event Variable ${cbusMsg.eventVariableIndex} Value has not Changed `});
                        }
                    } else {
                        winston.debug({message: `mergAdminNode: NEVAL: Event Variable ${cbusMsg.variable} Does not exist on config - adding`});
                        this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEvents[cbusMsg.eventIndex].variables[cbusMsg.eventVariableIndex] = cbusMsg.eventVariableValue
                        this.saveNode(cbusMsg.nodeNumber)
                    }
                } else {
                    winston.debug({message: `mergAdminNode: NEVAL: Event Index ${cbusMsg.eventIndex} Does not exist on config - skipping`});
                }
            },
            'B6': async (cbusMsg) => { //PNN Recieved from Node
                const ref = cbusMsg.nodeNumber
                const moduleIdentifier = cbusMsg.encoded.toString().substr(13, 4).toUpperCase()
                
                if (ref in this.nodeConfig.nodes) {
                  // already exists in config file...
                  winston.debug({message: `mergAdminNode: PNN (B6) Node found ` + JSON.stringify(this.nodeConfig.nodes[ref])})
                } else {
                  // doesn't exist in config file, so create it (but note flag update/create done later)
                  let output = {
                      "CANID": utils.getMGCCANID(cbusMsg.encoded),
                      "nodeNumber": cbusMsg.nodeNumber,
                      "manufacturerId": cbusMsg.manufacturerId,
                      "moduleId": cbusMsg.moduleId,
                      "moduleIdentifier": moduleIdentifier,
                      "moduleVersion": "",
                      "parameters": [],
                      "nodeVariables": [],
                      "storedEvents": {},
                      "storedEventsNI": {},
                      "status": true,
                      "eventCount": 0,
                      "services": {},
                      "component": 'mergDefault2',
                      "moduleName": 'Unknown',
                      "eventReadBusy":false,
                      "eventVariableReadBusy":false
                  }
                  this.nodeConfig.nodes[ref] = output
                }
                this.nodeConfig.nodes[ref].moduleName = this.getModuleName(moduleIdentifier)
                // force variableConfig to be reloaded
                this.nodeConfig.nodes[ref].variableConfig = undefined
                // always update/create the flags....
                this.nodeConfig.nodes[ref].flags = cbusMsg.flags
                this.nodeConfig.nodes[ref].flim = (cbusMsg.flags & 4) ? true : false
                this.nodeConfig.nodes[ref].consumer = (cbusMsg.flags & 1) ? true : false
                this.nodeConfig.nodes[ref].producer = (cbusMsg.flags & 2) ? true : false
                this.nodeConfig.nodes[ref].bootloader = (cbusMsg.flags & 8) ? true : false
                this.nodeConfig.nodes[ref].coe = (cbusMsg.flags & 16) ? true : false
                this.nodeConfig.nodes[ref].learn = (cbusMsg.flags & 32) ? true : false
                this.nodeConfig.nodes[ref].VLCB = (cbusMsg.flags & 64) ? true : false
                this.nodeConfig.nodes[ref].status = true
                await this.cbusSend((this.RQEVN(cbusMsg.nodeNumber)))
                this.saveNode(cbusMsg.nodeNumber)
                // now get file list & send event to socketServer
                this.emit('node_descriptor_file_list', cbusMsg.nodeNumber, config.getModuleDescriptorFileList(moduleIdentifier))
            },
            'B8': async (cbusMsg) => {//Accessory On Short Event 1
                this.eventSend(cbusMsg, 'on', 'short')
            },
            'B9': async (cbusMsg) => {//Accessory Off Short Event 1
                this.eventSend(cbusMsg, 'off', 'short')
            },
            'C7': async (cbusMsg) => {//Diagnostic
                winston.info({message: `DGN: ${cbusMsg.text}`})
                const ref = cbusMsg.nodeNumber
                if (cbusMsg.ServiceIndex > 0) {
                  // all valid service indexes start from 1 - service index 0 returns count of services
                  if (ref in this.nodeConfig.nodes) {
                    if (this.nodeConfig.nodes[ref]["services"][cbusMsg.ServiceIndex]) {
                      const ServiceType = this.nodeConfig.nodes[ref]["services"][cbusMsg.ServiceIndex]['ServiceType']
                      const ServiceVersion = this.nodeConfig.nodes[ref]["services"][cbusMsg.ServiceIndex]['ServiceVersion']
                      let output = {
                          "DiagnosticCode": cbusMsg.DiagnosticCode,
                          "DiagnosticValue": cbusMsg.DiagnosticValue
                      }
                      try{
                        if(this.ServiceDefs[ServiceType]['version'][ServiceVersion]['diagnostics'][cbusMsg.DiagnosticCode]){
                          output["DiagnosticName"] = this.ServiceDefs[ServiceType]['version'][ServiceVersion]['diagnostics'][cbusMsg.DiagnosticCode]['name']
                        }
                      } catch (err){
                        winston.warn({message: `mergAdminNode - DGN: failed to get diagnostic name for diagnostic code ${cbusMsg.DiagnosticCode} ` + err});
                      }
                      this.nodeConfig.nodes[ref]["services"][cbusMsg.ServiceIndex]['diagnostics'][cbusMsg.DiagnosticCode] = output
                      this.saveNode(cbusMsg.nodeNumber)
                    }
                    else {
                          winston.warn({message: `mergAdminNode - DGN: node config services does not exist for node ${cbusMsg.nodeNumber}`});
                    }
                  }
                  else {
                          winston.warn({message: `mergAdminNode - DGN: node config does not exist for node ${cbusMsg.nodeNumber}`});
                  }
                }
            },
            'D0': async (cbusMsg) => {//Accessory On Long Event 2
                this.eventSend(cbusMsg, 'on', 'long')
            },
            'D1': async (cbusMsg) => {//Accessory Off Long Event 2
                this.eventSend(cbusMsg, 'off', 'long')
            },
            'D3': async (cbusMsg) => {// EVANS - response to REQEV
              //
              var nodeNumber = this.nodeNumberInLearnMode
              var eventIdentifier = decToHex(cbusMsg.nodeNumber, 4) + decToHex(cbusMsg.eventNumber, 4) 
              this.storeEventVariableByIdentifier(nodeNumber, eventIdentifier, cbusMsg.eventVariableIndex, cbusMsg.eventVariableValue)
              winston.debug({message: name + `: EVANS(D3): eventIdentifier ${eventIdentifier}`});
              var tableIndex = utils.getEventTableIndex( this.nodeConfig.nodes[nodeNumber], eventIdentifier)
              winston.debug({message: name + `: EVANS(D3): tableIndex ${tableIndex}`});              
              if (tableIndex != null) {
                if (this.nodeConfig.nodes[nodeNumber].storedEvents[tableIndex].variables[cbusMsg.eventVariableIndex] != null) {
                    if (this.nodeConfig.nodes[nodeNumber].storedEvents[tableIndex].variables[cbusMsg.eventVariableIndex] != cbusMsg.eventVariableValue) {
                        winston.debug({message: name + `: EVANS(D3): Event Variable ${cbusMsg.variable} Value has Changed `});
                        this.nodeConfig.nodes[nodeNumber].storedEvents[tableIndex].variables[cbusMsg.eventVariableIndex] = cbusMsg.eventVariableValue
                        this.saveNode(nodeNumber)
                    } else {
                        winston.debug({message: name + `: EVANS(D3): Event Variable ${cbusMsg.eventVariableIndex} Value has not Changed `});
                    }
                } else {
                    winston.debug({message: name + `: EVANS(D3): Event Variable ${cbusMsg.variable} Does not exist on config - adding`});
                    this.nodeConfig.nodes[nodeNumber].storedEvents[tableIndex].variables[cbusMsg.eventVariableIndex] = cbusMsg.eventVariableValue
                    this.saveNode(nodeNumber)
                }
              } else {
                  winston.debug({message: name + `: EVANS(D3): Event Identifier ${eventIdentifier} Does not exist on config - skipping`});
              }
            },
            'D8': async (cbusMsg) => {//Accessory On Short Event 2
                this.eventSend(cbusMsg, 'on', 'short')
            },
            'D9': async (cbusMsg) => {//Accessory Off Short Event 2
                this.eventSend(cbusMsg, 'off', 'short')
            },
            'E1': async (cbusMsg) => { // PLOC
                let session = cbusMsg.session
                if (!(session in this.dccSessions)) {
                    this.dccSessions[session] = {}
                    this.dccSessions[session].count = 0
                }
                this.dccSessions[session].id = session
                this.dccSessions[session].loco = cbusMsg.address
                this.dccSessions[session].direction = cbusMsg.direction
                this.dccSessions[session].speed = cbusMsg.speed
                this.dccSessions[session].status = 'Active'
                this.dccSessions[session].F1 = cbusMsg.Fn1
                this.dccSessions[session].F2 = cbusMsg.Fn2
                this.dccSessions[session].F3 = cbusMsg.Fn3
                this.emit('dccSessions', this.dccSessions)
                winston.debug({message: `mergAdminNode: PLOC (E1) ` + JSON.stringify(this.dccSessions[session])})
            },
            'E7': async (cbusMsg) => {//Service Discovery
                // mode
                winston.debug({message: `mergAdminNode: Service Delivery ${JSON.stringify(cbusMsg)}`})
                this.nodeConfig.nodes[cbusMsg.nodeNumber]["services"][cbusMsg.ServiceNumber] = [cbusMsg.Data1, cbusMsg.Data2, cbusMsg.Data3, cbusMsg.Data4]
            },
            'EF': async (cbusMsg) => {//Request Node Parameter in setup
                // mode
                //winston.debug({message: `mergAdminNode: PARAMS (EF) Received`});
            },
            'F0': async (cbusMsg) => {//Accessory On Long Event 3
                this.eventSend(cbusMsg, 'on', 'long')
            },
            'F1': async (cbusMsg) => {//Accessory Off Long Event 3
                this.eventSend(cbusMsg, 'off', 'long')
            },
            'F2': async (cbusMsg) => {//ENSRP Response to NERD/NENRD
              // ENRSP Format: [<MjPri><MinPri=3><CANID>]<F2><NN hi><NN lo><EN3><EN2><EN1><EN0><EN#>
              const ref = cbusMsg.eventIndex
              if (!(ref in this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEvents)) {
                this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEvents[cbusMsg.eventIndex] = {
                    "eventIdentifier": cbusMsg.eventIdentifier,
                    "eventIndex": cbusMsg.eventIndex,
                    "node": cbusMsg.nodeNumber,
                    "variables": {}
                }
                if (this.nodeConfig.nodes[cbusMsg.nodeNumber].module == "CANMIO") {
                    //winston.info({message:`mergAdminNode: ENSRP CANMIO: ${cbusMsg.nodeNumber} :: ${cbusMsg.eventIndex}`})
                    //if (["CANMIO","LIGHTS"].includes(this.nodeConfig.nodes[cbusMsg.nodeNumber].module)){
                    /*setTimeout(() => {
                        this.cbusSend(this.REVAL(cbusMsg.nodeNumber, cbusMsg.eventIndex, 0))
                    }, 10 * ref)*/
                    setTimeout(async () => {
                      await this.cbusSend(this.REVAL(cbusMsg.nodeNumber, cbusMsg.eventIndex, 1))
                    }, 20 * ref)
                }
                if (this.nodeConfig.nodes[cbusMsg.nodeNumber].module == "LIGHTS") {
                    setTimeout(async () => {
                      await this.cbusSend(this.REVAL(cbusMsg.nodeNumber, cbusMsg.eventIndex, 1))
                    }, 100 * ref)
                }
                this.saveConfig()
              }
              const identifier = cbusMsg.eventIdentifier
              if (!(identifier in this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEventsNI)) {
                this.nodeConfig.nodes[cbusMsg.nodeNumber].storedEventsNI[identifier] = {
                    "eventIdentifier": cbusMsg.eventIdentifier,
                    "eventIndex": cbusMsg.eventIndex,
                    "node": cbusMsg.nodeNumber,
                    "variables": {}
                }
              this.saveConfig()
              }
            },
            'F8': async (cbusMsg) => {//Accessory On Short Event 3
                this.eventSend(cbusMsg, 'on', 'short')
            },
            'F9': async (cbusMsg) => {//Accessory Off Short Event 3
                this.eventSend(cbusMsg, 'off', 'short')
            },
            'DEFAULT': async (cbusMsg) => {
                winston.debug({message: "mergAdminNode: Opcode " + cbusMsg.opCode + ' is not supported by the Admin module'});
                let ref = cbusMsg.opCode

                if (ref in this.cbusNoSupport) {
                    this.cbusNoSupport[ref].cbusMsg = cbusMsg
                    this.cbusNoSupport[ref].count += 1
                } else {
                    let output = {}
                    output['opCode'] = cbusMsg.opCode
                    output['msg'] = {"message": cbusMsg.encoded}
                    output['count'] = 1
                    this.cbusNoSupport[ref] = output
                }
                this.emit('cbusNoSupport', this.cbusNoSupport)
            }
        }
        this.cbusSend(this.QNN())
    }

    isMessageValid(cbusMsg){
      var result = false
      var dataLength = (cbusMsg.encoded.length - 9) / 2
      // get numeric version of opCode
      var opCode = parseInt(cbusMsg.opCode, 16)
      if (opCode <= 0x1F){
        if (dataLength == 0){ result = true}
      }
      if ((opCode >= 0x20) && (opCode <= 0x3F)){
        if (dataLength == 1){ result = true}
      }
      if ((opCode >= 0x40) && (opCode <= 0x5F)){
        if (dataLength == 2){ result = true}
      }
      if ((opCode >= 0x60) && (opCode <= 0x7F)){
        if (dataLength == 3){ result = true}
      }
      if ((opCode >= 0x80) && (opCode <= 0x9F)){
        if (dataLength == 4){ result = true}
      }
      if ((opCode >= 0xA0) && (opCode <= 0xBF)){
        if (dataLength == 5){ result = true}
      }
      if ((opCode >= 0xC0) && (opCode <= 0xDF)){
        if (dataLength == 6){ result = true}
      }
      if ((opCode >= 0xE0) && (opCode <= 0xFF)){
        if (dataLength == 7){ result = true}
      }
      if (result == false){
        winston.error({message: name + `: opCode ` + cbusMsg.opCode + ` wrong data length: ` + dataLength});
      }
      return result
    }

    getModuleName(moduleIdentifier){
      var moduleName = 'Unknown'
      if (this.merg['modules'][moduleIdentifier]) {
        if (this.merg['modules'][moduleIdentifier]['name']) {
          moduleName = this.merg['modules'][moduleIdentifier]['name']
          return moduleName
        }
      }
      var list = this.config.getModuleDescriptorFileList(moduleIdentifier)
      winston.info({message: name + `: Descriptor File List: ` + JSON.stringify(list)});
      if (list[0]){
        var index = list[0].toString().search(moduleIdentifier)
        winston.info({message: name + `: moduleIdentifier position: ` + index});
        if (index > 1) {
          moduleName =list[0].substr(0,index-1)
        }
      }
      return moduleName
    }

    process_WRACK(nodeNumber) {
      winston.info({message: name + `: wrack : node ` + nodeNumber});

      /*
      winston.info({message: name + `: wrack : nodes_EventVariablesNeedRefreshing ` + JSON.stringify(this.nodes_EventVariablesNeedRefreshing)});
      if (this.nodes_EventVariablesNeedRefreshing.nodeNumber != undefined){
        if (this.nodes_EventVariablesNeedRefreshing.nodeNumber == nodeNumber){
          winston.info({message: name + `: wrack : EventVariablesNeedRefreshing for node ` + nodeNumber})
          let eventIndex = this.nodes_EventVariablesNeedRefreshing.eventIndex
          this.request_all_event_variables(nodeNumber, eventIndex)
        }
      }
      */
    }

    async process_GRSP (data) {
      winston.info({message: `mergAdminNode: grsp : data ` + JSON.stringify(data)});
      var nodeNumber = data.nodeNumber
      if (data.requestOpCode){
        if( (data.requestOpCode == "95") ||   // EVULN
            (data.requestOpCode == "D2") ){   // EVLRN
          // GRSP was for an event command
          winston.info({message: `mergAdminNode: GRSP for event command : node ` + nodeNumber});
          if (this.nodes_EventsNeedRefreshing[nodeNumber]){
            winston.info({message: 'mergAdminNode: GRSP for event command : need to refresh events'});
            await this.request_all_node_events(nodeNumber)
          }
        }
      }
    }


    async action_message(cbusMsg) {
        winston.info({message: "mergAdminNode: " + cbusMsg.mnemonic + " Opcode " + cbusMsg.opCode + ' processed'});
        if (this.actions[cbusMsg.opCode]) {
            await this.actions[cbusMsg.opCode](cbusMsg);
        } else {
            await this.actions['DEFAULT'](cbusMsg);
        }
    }

    storeEventVariableByIdentifier(nodeNumber, eventIdentifier, eventVariableIndex, eventVariableValue){
      winston.debug({message: name + `: storeEventVariable: ${nodeNumber} ${eventIdentifier} ${eventVariableIndex} ${eventVariableValue}`});
      try {
        var node = this.nodeConfig.nodes[nodeNumber]
        if (eventIdentifier){
          node.storedEventsNI[eventIdentifier].variables[eventVariableIndex] = eventVariableValue
        }
      } catch (err) {
        winston.debug({message: name + `: storeEventVariableByIdentifier: error ${err}`});
      }
    }

    storeEventVariableByIndex(nodeNumber, eventIndex, eventVariableIndex, eventVariableValue){
      winston.debug({message: name + `: storeEventVariable: ${nodeNumber} ${eventIndex} ${eventVariableIndex} ${eventVariableValue}`});
      try {
        var node = this.nodeConfig.nodes[nodeNumber]
        var eventIdentifier = utils.getEventIdentifier(node, eventIndex)
        winston.debug({message: name + `: storeEventVariable: eventIdentifier ${eventIdentifier}`});
        if (eventIdentifier){
          node.storedEventsNI[eventIdentifier].variables[eventVariableIndex] = eventVariableValue
        }
      } catch (err) {
        winston.debug({message: name + `: storeEventVariable: error ${err}`});
      }
    }

    removeNodeEvents(nodeNumber) {
      if(this.nodeConfig.nodes[nodeNumber]){
        this.nodeConfig.nodes[nodeNumber].storedEvents = {}
        this.nodeConfig.nodes[nodeNumber].storedEventsNI = {}
        this.saveConfig()
      }
    }

    removeEvent(eventNumber) {
        delete this.nodeConfig.events[eventNumber]
        this.saveConfig()
    }

    clearCbusErrors() {
        this.cbusErrors = {}
        this.emit('cbusError', this.cbusErrors)
    }

    async cbusSend(msg) {
      if (typeof msg !== 'undefined') {
        let output = JSON.stringify(msg)
        this.client.write(output);
        winston.debug({message: `mergAdminNode: CBUS Transmit >>>  ${output}`})
        let tmp = cbusLib.decode(cbusLib.encode(msg).encoded) //do double trip to get text
        this.emit('cbusTraffic', {direction: 'Out', json: tmp});
        await utils.sleep(20)
      }
    }

    refreshEvents() {
        this.emit('events', this.nodeConfig.events)
    }

    clearEvents() {
        winston.info({message: `mergAdminNode: clearEvents() `});
        this.nodeConfig.events = {}
        this.saveConfig()
        this.emit('events', this.nodeConfig.events)
    }

    eventSend(cbusMsg, status, type) {
        let busIdentifier = cbusMsg.encoded.substr(9, 8)
        let eventIdentifier = busIdentifier
        //need to remove node number from event identifier if short event
        if (type == 'short') {
          eventIdentifier = "0000" + eventIdentifier.slice(4)
        }
        if (busIdentifier in this.nodeConfig.events) {
            this.nodeConfig.events[busIdentifier]['status'] = status
            this.nodeConfig.events[busIdentifier]['count'] += 1
        } else {
            let output = {}
            output['eventIdentifier'] = eventIdentifier
            output['nodeNumber'] = cbusMsg.nodeNumber
            if (type == 'short') {
                output['eventNumber'] = cbusMsg.deviceNumber
            } else {
                output['eventNumber'] = cbusMsg.eventNumber
            }
            output['status'] = status
            output['type'] = type
            output['count'] = 1
            //output['data'] = cbusMsg.eventData.hex
            this.nodeConfig.events[busIdentifier] = output
            winston.debug({message: name + `: EventSend added to events ${busIdentifier}`});
          }
        winston.info({message: 'mergAdminNode: EventSend : ' + JSON.stringify(this.nodeConfig.events[busIdentifier])});
        //this.saveConfig()
        this.emit('events', this.nodeConfig.events);
    }


    saveConfig() {
        winston.info({message: 'mergAdminNode: Save Config : '});
        this.config.writeNodeConfig(this.nodeConfig)
        this.emit('nodes', this.nodeConfig.nodes);
    }

    saveNode(nodeNumber) {
      winston.info({message: 'mergAdminNode: Save Node : ' + nodeNumber});
      if (this.nodeConfig.nodes[nodeNumber] == undefined){
        this.nodeConfig.nodes[nodeNumber] = {
          "nodeNumber": nodeNumber,
          "eventVariableReadBusy": false
        } 
      }
      this.checkNodeDescriptor(nodeNumber); // do before emit node
      this.config.writeNodeConfig(this.nodeConfig)
      this.emit('node', this.nodeConfig.nodes[nodeNumber])
    }



    checkNodeDescriptor(nodeNumber){
      if (this.nodeDescriptors[nodeNumber] == undefined) {
        // only proceed if nodeDescriptor doesn't exist, if it does exist, then just return, nothing to see here...
        if (this.nodeConfig.nodes[nodeNumber]){
          var moduleName = this.nodeConfig.nodes[nodeNumber].moduleName;                  // should be populated by PNN
          var moduleIdentifier = this.nodeConfig.nodes[nodeNumber].moduleIdentifier;      // should be populated by PNN
          if ((moduleName == "Unknown") || (moduleName == undefined)) {
            // we can't handle a module we don't know about, so just warn & skip rest
            winston.warn({message: 'mergAdminNode: checkNodeDescriptor : module unknown'});
          } else {
            // build filename
            var filename = moduleName + "-" + moduleIdentifier               
            // need major & minor version numbers to complete building of filename
            if ((this.nodeConfig.nodes[nodeNumber].parameters[7] != undefined) && (this.nodeConfig.nodes[nodeNumber].parameters[2] != undefined))
            {
              // get & store the version
              this.nodeConfig.nodes[nodeNumber].moduleVersion = this.nodeConfig.nodes[nodeNumber].parameters[7] + String.fromCharCode(this.nodeConfig.nodes[nodeNumber].parameters[2])
              filename += "-" + this.nodeConfig.nodes[nodeNumber].moduleVersion
              filename += ".json"
              // ok - can get file now
              // but don't store the filename in nodeConfig until we're tried to read the file
              try {
                const moduleDescriptor = this.config.readModuleDescriptor(filename)
                this.nodeDescriptors[nodeNumber] = moduleDescriptor
                this.config.writeNodeDescriptors(this.nodeDescriptors)
                winston.info({message: 'mergAdminNode: checkNodeDescriptor: loaded file ' + filename});
                var payload = {[nodeNumber]:moduleDescriptor}
                this.emit('nodeDescriptor', payload);
              }catch(err) {
                winston.error({message: 'mergAdminNode: checkNodeDescriptor: error loading file ' + filename + ' ' + err});
              }
              // ok, we've tried to read the file, and sent it if it succeeded, so set the filename in nodeConfig
              // and the client can check for filename, and if no data, then fileload failed
              this.nodeConfig.nodes[nodeNumber]['moduleDescriptorFilename'] = filename
            }
          }
        }
      }
    }


    async holdIfBusy(busyFlag){
      var count = 0;
      while(busyFlag){
        await sleep(10);
        count++
        // check to ensure it doesn't lock up in this routine
        if (count > 1000){
          winston.info({message: 'mergAdminNode: busy hold break...... '});
          break
        }
      }
//      winston.info({message: 'mergAdminNode: busy hold released at count ' + count});
    }


//************************************************************************ */
//
// functions called by the socket service
// in alphabetical order
//
//************************************************************************ */

  async query_all_nodes(){
    winston.info({message: name + ': query_all_nodes'});
    for (let node in this.nodeConfig.nodes) {
      this.nodeConfig.nodes[node].status = false
    }
    this.nodeDescriptors = {}   // force re-reading of module descriptors...
    this.saveConfig()
    await this.cbusSend(this.QNN())
  }

  async remove_event(nodeNumber, eventName) {
    await this.cbusSend(this.NNLRN(nodeNumber))
    await this.cbusSend(this.EVULN(eventName))
    await this.cbusSend(this.NNULN(nodeNumber))
    this.nodes_EventsNeedRefreshing[nodeNumber]=true
  }

  
  remove_node(nodeNumber) {
    winston.info({message: name + ': remove_node ' + nodeNumber});
    var nodes = Object.keys(this.nodeConfig.nodes)  // just get node numbers
    winston.info({message: name + ': nodes ' + nodes});
    delete this.nodeConfig.nodes[nodeNumber]
    nodes = Object.keys(this.nodeConfig.nodes)  // just get node numbers
    winston.info({message: name + ': nodes ' + nodes});
    this.saveConfig()
  }

  // need to use event index here, as used outside of learn mode
  async request_all_event_variables(nodeNumber, eventIndex, variableCount){
    // don't start if already being read
    this.holdIfBusy(this.nodeConfig.nodes[nodeNumber].eventReadBusy)
    if(this.nodeConfig.nodes[nodeNumber].eventReadBusy==false){
      // need to prevent all events being refreshed whilst we're doing this
      this.nodeConfig.nodes[nodeNumber].eventVariableReadBusy=true
      // check event still exists first, as some events are dynamic on the module
      if (this.nodeConfig.nodes[nodeNumber].storedEvents[eventIndex]){
        // let clear out existing event variables...
//        this.nodeConfig.nodes[nodeNumber].storedEvents[eventIndex].variables = {}
        // now try reading EV0 - should return number of event variables
        await this.cbusSend(this.REVAL(nodeNumber, eventIndex, 0))
        await sleep(300); // wait for a response before trying to use it
        // now assume number of variables from param 5, but use the value in EV0 if it exists
        var numberOfVariables = this.nodeConfig.nodes[nodeNumber].parameters[5]
        if (this.nodeConfig.nodes[nodeNumber].storedEvents[eventIndex].variables[0] > 0 ){
          numberOfVariables = this.nodeConfig.nodes[nodeNumber].storedEvents[eventIndex].variables[0]
        }
        // now read event variables
        for (let i = 1; i <= numberOfVariables; i++) {
          await sleep(50); // allow time between requests
          await this.cbusSend(this.REVAL(nodeNumber, eventIndex, i))
        }
      }
      this.nodeConfig.nodes[nodeNumber].eventVariableReadBusy=false
    } else {
      winston.info({message: 'mergAdminNode: request_all_event_variables: blocked '});
    }
  }

  addNodeToConfig(nodeNumber){
    this.nodeConfig.nodes[nodeNumber] = {eventVariableReadBusy:false}
  }

  async request_all_node_events(nodeNumber){
    winston.debug({message: 'mergAdminNode: request_all_node_events: node ' + nodeNumber});
    if (this.nodeConfig.nodes[nodeNumber] == undefined){this.addNodeToConfig(nodeNumber)}
    // don't start this if we already have an event variable read in progress
//    this.holdIfBusy(this.nodeConfig.nodes[nodeNumber].eventVariableReadBusy)
//    if(this.nodeConfig.nodes[nodeNumber].eventVariableReadBusy==false){
    if(true){
      winston.debug({message: 'mergAdminNode: request_all_node_events: start process '});
      this.nodeConfig.nodes[nodeNumber].eventReadBusy=true
      await this.cbusSend(this.RQEVN(nodeNumber))
      this.removeNodeEvents(nodeNumber)
      await this.cbusSend(this.NERD(nodeNumber))
      this.nodes_EventsNeedRefreshing[nodeNumber]=false
      var delay = 50 * this.nodeConfig.nodes[nodeNumber].eventCount
      await sleep(delay)  // give it some time to complete
      this.nodeConfig.nodes[nodeNumber].eventReadBusy=false      
    } else {
      winston.info({message: 'mergAdminNode: request_all_node_events: blocked '});
    }

  }

  async request_all_node_parameters(nodeNumber){
    await this.cbusSend(this.RQNPN(nodeNumber, 0))    // get number of node parameters
    await sleep(400); // wait for a response before trying to use it
    let nodeParameterCount = this.nodeConfig.nodes[nodeNumber].parameters[0]
    for (let i = 1; i <= nodeParameterCount; i++) {
      await this.cbusSend(this.RQNPN(nodeNumber, i))
      await sleep(50); // allow time between requests
    }
  }

  async request_all_node_variables(nodeNumber, start){
    // get number of node variables - but wait till it exists
    while (1){
      if (this.nodeConfig.nodes[nodeNumber].parameters[6] != undefined) {break}
      await sleep(50); // allow time between requests
    }
    let nodeVariableCount = this.nodeConfig.nodes[nodeNumber].parameters[6]
    for (let i = start; i <= nodeVariableCount; i++) {
      await this.cbusSend(this.NVRD(nodeNumber, i))
      await sleep(50); // allow time between requests
    }
  }

  // teach_event not only creates a new event, but needs to refresh the events
  // as the indexs for events for that node may have changed once a new event has been created
  async teach_event(nodeNumber, eventIdentifier, variableId, value) {
    await this.cbusSend(this.NNLRN(nodeNumber))
    await this.cbusSend(this.EVLRN(nodeNumber, eventIdentifier, variableId, value))
    await sleep(50); // allow a bit more time after EVLRN
    await this.cbusSend(this.NNULN(nodeNumber))
    await this.cbusSend(this.NNULN(nodeNumber))   // do we really need this 2nd NNULN?
    await this.request_all_node_events(nodeNumber)
  }

  // update_event_variable not only updates the variable, but refreshes all the variables for that event
  // This is why it's different to 'teach_event'
  async update_event_variable(data){
    winston.info({message: name +': update_event_variable: data ' + JSON.stringify(data)});
    await this.cbusSend(this.NNLRN(data.nodeNumber))
    await this.cbusSend(this.EVLRN(data.nodeNumber, data.eventName, data.eventVariableId, data.eventVariableValue))
    await sleep(50); // allow a bit more time after EVLRN
    await this.cbusSend(this.NNULN(data.nodeNumber))
    await this.requestEventVariablesByIdentifier(data.nodeNumber, data.eventName)
  }

  async event_teach_by_identifier(nodeNumber, eventIdentifier, eventVariableIndex, eventVariableValue) {
    winston.debug({message: name +': event_teach_by_identity: ' + nodeNumber + " " + eventIdentifier})
    //var refreshEvents = !this.eventIdentifierExists(nodeNumber, eventIdentifier)
    var refreshEvents = false
    if (utils.getEventTableIndex(this.nodeConfig.nodes[nodeNumber], eventIdentifier) == null){
      refreshEvents = true
    } 
    await this.cbusSend(this.NNLRN(nodeNumber))
    await this.cbusSend(this.EVLRN(nodeNumber, eventIdentifier, eventVariableIndex, eventVariableValue))
    await sleep(50); // allow a bit more time after EVLRN
    await this.cbusSend(this.NNULN(nodeNumber))
    if (refreshEvents){
      winston.debug({message: name + ": event_teach_by_identity: event didn't exist, so refresh all events"})
      await this.request_all_node_events(nodeNumber)
    } else {
      winston.debug({message: name + ": event_teach_by_identity: event already existed, so don't refresh all events"})
    }
    await this.requestEventVariablesByIdentifier(nodeNumber, eventIdentifier)
  }


  async requestEventVariablesByIdentifier(nodeNumber, eventIdentifier){
    winston.info({message: name + ': requestEventVariables ' + nodeNumber + ' ' + eventIdentifier});
    await this.cbusSend(this.NNLRN(nodeNumber))
    this.nodeNumberInLearnMode = nodeNumber
    await this.cbusSend(this.REQEV(eventIdentifier, 0))
    await sleep(50); // wait for a response before trying to use it
    // now initially assume number of variables from param 5, but use the value in EV0 if it exists
    var numberOfVariables = utils.getMaxNumberOfEventVariables(this.nodeConfig, nodeNumber)
    // now look for EV0 if returned, so we need the index into the table for this
    var tableIndex = utils.getEventTableIndex(this.nodeConfig.nodes[nodeNumber], eventIdentifier)
    winston.info({message: name + ': requestEventVariables: tableIndex ' + tableIndex})
    if (tableIndex) {
      try{
        numberOfVariables = this.nodeConfig.nodes[nodeNumber].storedEvents[tableIndex].variables[0]
      } catch(err){
        winston.debug({message: name + ': requestEventVariables: storedEvents.variables[0] failed ' + err});
      }
    }
    winston.debug({message: name + ': requestEventVariables: number of variables ' + numberOfVariables});
    // now read event variables
    for (let i = 1; i <= numberOfVariables; i++) {
      await this.cbusSend(this.REQEV(eventIdentifier, i))
    }
    // ok, take out of learn mode now
    await this.cbusSend(this.NNULN(nodeNumber))  
    this.nodeNumberInLearnMode = null
    this.saveNode(nodeNumber)
  }


//************************************************************************ */
//
// Functions to create json VLCB messages
// in opcode order
//
//************************************************************************ */    
  
  // 0x0D QNN
  //
  QNN() {//Query Node Number
    let output = {}
    output['mnemonic'] = 'QNN'
    return output;
  }

  // 0x10 RQNP
  //
  RQNP() {//Request Node Parameters
      let output = {}
      output['mnemonic'] = 'RQNP'
      return output;
  }

  // 0x22 QLOC
  //
  QLOC(sessionId) {
      let output = {}
      output['mnemonic'] = 'QLOC'
      output['session'] = sessionId
      return output
  }

  // 0x42
  //
  SNN(nodeNumber) {
      if (nodeNumber >= 0 && nodeNumber <= 0xFFFF) {
          let output = {}
          output['mnemonic'] = 'SNN'
          output['nodeNumber'] = nodeNumber
          return output
      }
  }

  // 0x53 NNLRN
  //
  NNLRN(nodeNumber) {
      if (nodeNumber >= 0 && nodeNumber <= 0xFFFF) {
          let output = {}
          output['mnemonic'] = 'NNLRN'
          output['nodeNumber'] = nodeNumber
          return output
      }
  }

  // 0x54 NNULN
  //
  NNULN(nodeNumber) {
      let output = {}
      output['mnemonic'] = 'NNULN'
      output['nodeNumber'] = nodeNumber
      return output
  }

  // 0x57 NERD
  //
  NERD(nodeNumber) {//Request All Events
      let output = {}
      output['mnemonic'] = 'NERD'
      output['nodeNumber'] = nodeNumber
      return output
  }

  // 0x58 RQEVN
  //
  RQEVN(nodeNumber) {// Read Node Variable
      let output = {}
      output['mnemonic'] = 'RQEVN'
      output['nodeNumber'] = nodeNumber
      return output;
  }

  // 0x72 NENRD
  //
  NENRD(nodeNumber, eventNumber) { //Request specific event
      let output = {}
      output['mnemonic'] = 'NENRD'
      output['nodeNumber'] = nodeNumber
      output['eventIndex'] = eventNumber
      return output
  }

  // 0x73 RQNPN
  //
  RQNPN(nodeNumber, param) {//Read Node Parameter
      let output = {}
      output['mnemonic'] = 'RQNPN'
      output['nodeNumber'] = nodeNumber
      output['parameterIndex'] = param
      return output
  }

  // 0x78 RQSD
  //
  RQSD(nodeNumber, service) { //Request Service Delivery
      let output = {}
      output['mnemonic'] = 'RQSD'
      output['nodeNumber'] = nodeNumber
      output['ServiceIndex'] = service
      return output
      //return cbusLib.encodeRQSD(nodeNumber, ServiceNumber);
  }

  // 0x9C REVAL
  //
  REVAL(nodeNumber, eventNumber, valueId) {//Read an Events EV by index
      //winston.info({message: 'mergAdminNode: REVAL '})
      let output = {}
      output['mnemonic'] = 'REVAL'
      output['nodeNumber'] = nodeNumber
      output['eventIndex'] = eventNumber
      output['eventVariableIndex'] = valueId
      return output;
      //return cbusLib.encodeREVAL(nodeNumber, eventNumber, valueId);
  }

  RDGN(nodeNumber, service, diagCode) { //Request Diagnostics
      let output = {}
      output['mnemonic'] = 'RDGN'
      output['nodeNumber'] = nodeNumber
      output['ServiceIndex'] = service
      output['DiagnosticCode'] = diagCode
      winston.info({message: 'mergAdminNode: RDGN : ' + JSON.stringify(output)})
      return output
      //return cbusLib.encodeRDGN(nodeNumber ServiceNumber, DiagnosticCode);
  }

  update_event(nodeNumber, eventIdentifier, variableId, value){
//      this.nodeConfig.nodes[nodeNumber].storedEvents[eventIndex].variables[variableId] = value
      return this.EVLRN(nodeNumber, eventIdentifier, variableId, value)
  }


  // 0x9C REVAL
  //
  REQEV(eventIdentifier, variableIndex) {//Read an Events EV by identifier - must be in learn mode
    //winston.info({message: 'mergAdminNode: REQEV '})
    let output = {}
    output['mnemonic'] = 'REQEV'
    output['nodeNumber'] = parseInt(eventIdentifier.substr(0, 4), 16)
    output['eventNumber'] = parseInt(eventIdentifier.substr(4, 4), 16)
    output['eventVariableIndex'] = variableIndex
    return output;
    //return cbusLib.encodeREVAL(nodeNumber, eventNumber, valueId);
}

EVLRN(nodeNumber, eventIdentifier, variableId, value) {
    winston.debug({message: 'mergAdminNode: EVLRN: ' + nodeNumber + ' ' + eventIdentifier + ' ' + variableId + ' ' + value})
    this.saveNode(nodeNumber)
    let output = {}
    output['mnemonic'] = 'EVLRN'
    output['nodeNumber'] = parseInt(eventIdentifier.substr(0, 4), 16)
    output['eventNumber'] = parseInt(eventIdentifier.substr(4, 4), 16)
    output['eventVariableIndex'] = variableId
    output['eventVariableValue'] = value
    return output;
  }

  EVULN(event) {//Remove an Event in Learn mMode
      let output = {}
      output['mnemonic'] = 'EVULN'
      output['nodeNumber'] = parseInt(event.substr(0, 4), 16)
      output['eventNumber'] = parseInt(event.substr(4, 4), 16)
      return output
      //return cbusLib.encodeEVULN(parseInt(event.substr(0, 4), 16), parseInt(event.substr(4, 4), 16));

  }

  NVRD(nodeNumber, variableId) {// Read Node Variable
      let output = {}
      output['mnemonic'] = 'NVRD'
      output['nodeNumber'] = nodeNumber
      output['nodeVariableIndex'] = variableId
      winston.info({message: `mergAdminNode: NVRD : ${nodeNumber} :${JSON.stringify(output)}`})
      return output
      //return cbusLib.encodeNVRD(nodeNumber, variableId);
  }

  NVSET(nodeNumber, variableId, variableVal) {// Read Node Variable
      this.nodeConfig.nodes[nodeNumber].nodeVariables[variableId] = variableVal
      this.saveConfig()
      let output = {}
      output['mnemonic'] = 'NVSET'
      output['nodeNumber'] = nodeNumber
      output['nodeVariableIndex'] = variableId
      output['nodeVariableValue'] = variableVal
      return output

      //return cbusLib.encodeNVSET(nodeNumber, variableId, variableVal);

  }

  ACON(nodeNumber, eventNumber) {
      const eventIdentifier = decToHex(nodeNumber, 4) + decToHex(eventNumber, 4)
      //winston.debug({message: `mergAdminNode: ACON admin ${eventIdentifier}`});
      let output = {}
      if (eventIdentifier in this.nodeConfig.events) {
          this.nodeConfig.events[eventIdentifier]['status'] = 'on'
          this.nodeConfig.events[eventIdentifier]['count'] += 1
      } else {
          output['eventIdentifier'] = eventIdentifier
          output['nodeNumber'] = nodeNumber
          output['eventNumber'] = eventNumber
          output['status'] = 'on'
          output['type'] = 'long'
          output['count'] = 1
          this.nodeConfig.events[eventIdentifier] = output
          winston.debug({message: name + `: ACON added to events ${eventIdentifier}`});
        }
      this.emit('events', this.nodeConfig.events)
      output = {}
      output['mnemonic'] = 'ACON'
      output['nodeNumber'] = nodeNumber
      output['eventNumber'] = eventNumber
      return output
      //return cbusLib.encodeACON(nodeNumber, eventNumber);
  }

  ACOF(nodeNumber, eventNumber) {
      const eventIdentifier = decToHex(nodeNumber, 4) + decToHex(eventNumber, 4)
      //winston.debug({message: `mergAdminNode: ACOF admin ${eventIdentifier}`});
      let output = {}
      if (eventIdentifier in this.nodeConfig.events) {
          this.nodeConfig.events[eventIdentifier]['status'] = 'off'
          this.nodeConfig.events[eventIdentifier]['count'] += 1
      } else {
        output['eventIdentifier'] = eventIdentifier
        output['nodeNumber'] = nodeNumber
        output['eventNumber'] = eventNumber
        output['status'] = 'off'
        output['type'] = 'long'
        output['count'] = 1
        this.nodeConfig.events[eventIdentifier] = output
        winston.debug({message: name + `: ACOF added to events ${eventIdentifier}`});
    }
      this.emit('events', this.nodeConfig.events)
      output = {}
      output['mnemonic'] = 'ACOF'
      output['nodeNumber'] = nodeNumber
      output['eventNumber'] = eventNumber
      return output
  }

  ASON(nodeNumber, deviceNumber) {
    // short event, bus data has the source node number
    // but the actual short event only has device number - node number is zero
    // so we use a separate busIdentifer as well
    const busIdentifier = decToHex(nodeNumber, 4) + decToHex(deviceNumber, 4)
    const eventIdentifier = '0000' + decToHex(deviceNumber, 4)
    let output = {}
    if (busIdentifier in this.nodeConfig.events) {
        this.nodeConfig.events[busIdentifier]['status'] = 'on'
        this.nodeConfig.events[busIdentifier]['count'] += 1
    } else {
        output['eventIdentifier'] = eventIdentifier
        output['nodeNumber'] = nodeNumber
        output['eventNumber'] = deviceNumber
        output['status'] = 'on'
        output['type'] = 'short'
        output['count'] = 1
        this.nodeConfig.events[busIdentifier] = output
        winston.debug({message: name + `: ASON added to events ${busIdentifier}`});
    }
    this.emit('events', this.nodeConfig.events)
    output = {}
    output['mnemonic'] = 'ASON'
    output['nodeNumber'] = nodeNumber
    output['deviceNumber'] = deviceNumber
    return output
  }

  ASOF(nodeNumber, deviceNumber) {
    // short event, bus data has the source node number
    // but the actual short event only has device number - node number is zero
    // so we use a separate busIdentifer as well
    const busIdentifier = decToHex(nodeNumber, 4) + decToHex(deviceNumber, 4)
    const eventIdentifier = '0000' + decToHex(deviceNumber, 4)
    let output = {}
    if (busIdentifier in this.nodeConfig.events) {
        this.nodeConfig.events[busIdentifier]['status'] = 'off'
        this.nodeConfig.events[busIdentifier]['count'] += 1
    } else {
        output['eventIdentifier'] = eventIdentifier
        output['nodeNumber'] = nodeNumber
        output['eventNumber'] = deviceNumber
        output['status'] = 'off'
        output['type'] = 'short'
        output['count'] = 1
        this.nodeConfig.events[busIdentifier] = output
        winston.debug({message: name + `: ASOF added to events ${busIdentifier}`});
    }
    this.emit('events', this.nodeConfig.events)
    output = {}
    output['mnemonic'] = 'ASOF'
    output['nodeNumber'] = nodeNumber
    output['deviceNumber'] = deviceNumber
    return output
  }

};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    cbusAdmin: cbusAdmin
}


