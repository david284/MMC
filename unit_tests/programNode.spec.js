const winston = require('./config/winston_test.js')
winston.info({message: 'FILE: programNode.spec.js'});
const expect = require('chai').expect;
var itParam = require('mocha-param');
const fs = require('fs');
const jsonfile = require('jsonfile')
const utils = require('../VLCB-server/utilities.js');

const cbusLib = require('cbuslibrary')

const NET_PORT = 5591;
const NET_ADDRESS = "127.0.0.1"

const testSystemConfigPath = "./unit_tests/test_output/config"
const testUserConfigPath = "./unit_tests/test_output/test_user"
const config = require('../VLCB-server/configuration.js')(testSystemConfigPath, testUserConfigPath)

// set config items
config.setServerAddress("localhost")
config.setCbusServerPort(5570);
config.setJsonServerPort(5591);
config.setSocketServerPort(5572);


const mock_jsonServer = new (require('./mock_jsonServer'))(config.getJsonServerPort())


describe('programNode tests', async function(){
    

  before(async function(done) {
		winston.info({message: ' '});
		winston.info({message: '======================================================================'});
		winston.info({message: '------------------------ Program Node tests --------------------------'});
		winston.info({message: '======================================================================'});
		winston.info({message: ' '});
      done();
      await utils.sleep(1000) // allow time for clients to connect
  	});
    
    beforeEach(function() {
      winston.info({message: '  '});   // blank line to separate tests
      winston.debug({message: '  '});   // blank line to separate tests
      mock_jsonServer.messagesIn = []
    })

	after(function(done) {
   		winston.info({message: ' '});   // blank line to separate tests
        setTimeout(() => {
            winston.debug({message: 'TEST: programNode: Tests ended'});
            done();
        }, 1000)
	});																										
	
	//
    // Start of actual tests................
    // 


    //
    //
    //
	it('Checksum test', function() {
		winston.info({message: 'TEST: >>>>>> BEGIN: Checksum:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    // expect to get two's compliment of 16 bit checksum returned
    var array = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00]
    // checksum of above is 06F9, so two's complement is F907
    var expected  = 'F907'
    expect(programNode.arrayChecksum(array)).to.equal(expected);
		winston.info({message: 'TEST: <<<<<< END: Checksum:'});
	});


  //
  // Use real hex file to ensure correct operation
  //
  it('ParseHexFile short test', function() {
    winston.info({message: 'TEST: >>>>>> BEGIN: ParseHexFile short test:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/shortFile.HEX');
    var callbackInvoked = false
    var result = programNode.parseHexFile( intelHexString );
    expect(result).to.equal(true);
    winston.info({message: 'TEST: <<<<<< END: ParseHexFile short test:'});
  });


  //
  //
  //
  it('ParseHexFile configOnly test', function() {
    winston.info({message: 'TEST: >>>>>> BEGIN: ParseHexFile configOnly test:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/configOnly.HEX');
    var callbackInvoked = false
    var result = programNode.parseHexFile( intelHexString );
    expect(result).to.equal(true);
    winston.info({message: 'TEST: <<<<<< END: ParseHexFile configOnly test:'});
  });


  //
  //
  //
  it('ParseHexFile eepromOnly test', function() {
    winston.info({message: 'TEST: >>>>>> BEGIN: ParseHexFile eepromOnly test:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/eepromOnly.HEX');
    var callbackInvoked = false
    var result = programNode.parseHexFile( intelHexString );
    expect(result).to.equal(true);
    winston.info({message: 'TEST: <<<<<< END: ParseHexFile eepromOnly test:'});
  });


  //
  // Use real hex file to ensure correct operation
  //
  it('ParseHexFile full test', function() {
    winston.info({message: 'TEST: >>>>>> BEGIN: ParseHexFile full test:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    let filename = './unit_tests/test_firmware/CANPAN3.4c-108.HEX'
//    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/CANACC5_v2v.HEX');
//    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/Universal-VLCB4a4-18F26K80-16MHz.HEX');
    var intelHexString = fs.readFileSync(filename);
//    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/Universal-VLCB4a4-18F27Q83-16MHz.HEX');
    winston.info({message: 'TEST: Parsing file ' + filename});
    var result = programNode.parseHexFile( intelHexString );
    expect(result).to.equal(true);
    winston.info({message: 'TEST: <<<<<< END: ParseHexFile full test:'});
  });


  //
  // Use real hex file to ensure correct operation
  //
  it('ParseHexFile corrupt test', function() {
    winston.info({message: 'TEST: >>>>>> BEGIN: ParseHexFile corrupt test:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/corruptFile.HEX');
    var result = programNode.parseHexFile( intelHexString );
    expect(result).to.equal(false);
    winston.info({message: 'TEST: <<<<<< END: ParseHexFile corrupt test:'});
  });
  
  
  function GetTestCase_lines() {
    var arg1, testCases = [];
    for (var a = 1; a<= 10; a++) {
      if (a == 1) {arg1 = ':04000000FEEF03F01C'}
      if (a == 2) {arg1 = ':0400080004EF04F00D'}
      if (a == 3) {arg1 = ':040018000CEF04F0F5'}
      if (a == 4) {arg1 = ':1007F200CCEC00F001017581D8D54BEF00F001EF90'}
      if (a == 5) {arg1 = ':0208020005F0FF'}
      if (a == 6) {arg1 = ':10082000A56120FF147F040B1701000800000000E1'}
      if (a == 7) {arg1 = ':10ED340000010103020202020302020301000001B6'}
      if (a == 8) {arg1 = ':020000040030CA'}
      if (a == 9) {arg1 = ':0300010006061ED2'}
      if (a == 10) {arg1 = ':00000001FF'}
      testCases.push({'line':arg1});
    }
    return testCases;
  }
  

  //
  //
  //
  itParam("decodeLineNG test ${JSON.stringify(value)}", GetTestCase_lines(), function (value) {
//	it('decodeLineNG test', function() {
		winston.info({message: 'TEST: BEGIN: decodeLineNG:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
		var result = programNode.decodeLineNG(value.line);
    expect(result).to.equal(true);
		winston.info({message: 'TEST: END: decodeLineNG:'});
	});


  //
  // test line checksum works on decode line function
  //
	it('decode line checksum test', function() {
		winston.info({message: 'TEST: >>>>>> BEGIN: decode line checksum:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
		var result = programNode.decodeLineNG(':00000008FF');
    expect(result).to.equal(false);
		winston.info({message: 'TEST: <<<<<< END: decode line checksum:'});
	});


	it('program short test', async function() {
		winston.info({message: 'TEST: BEGIN program short:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    programNode.on('programNode_progress', function (data) {
    	downloadData = data;
	    winston.warn({message: 'TEST: short download: ' + JSON.stringify(downloadData)});
		});	        
    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/shortFile.HEX');
		await programNode.program(3000, 1, 3, intelHexString);
    programNode.removeAllListeners()
    //
    //
    // expect first message to be BOOTM
    var firstMsg = cbusLib.decode(mock_jsonServer.messagesIn[0])
    winston.info({message: 'TEST: short download: first message: ' + JSON.stringify(firstMsg)});
    expect(firstMsg.ID_TYPE).to.equal('S', 'first message ID_TYPE');
    expect(firstMsg.opCode).to.equal('5C', 'first message BOOTM 5C');
    //
    //
    // verify checksum when process is signalled as complete
    expect(downloadData.status).to.equal('Success', 'Download event');
    expect(downloadData.text).to.equal('Success: programing completed', 'Download event');
//    expect(mock_jsonServer.firmwareChecksum).to.equal('C68E', 'Checksum');
    //
    // check last message is a reset command
    winston.info({message: 'TEST: short download: number of message: ' + mock_jsonServer.messagesIn.length});
    var lastMsg = mock_jsonServer.messagesIn[mock_jsonServer.messagesIn.length - 1]
    winston.info({message: 'TEST: short download: last message: ' + JSON.stringify(lastMsg)});
    var lastMsg = cbusLib.decode(lastMsg)
    winston.debug({message: 'TEST: short download: last message: ' + lastMsg.text});
    expect(lastMsg.ID_TYPE).to.equal('X', 'last message ID_TYPE');
    expect(lastMsg.type).to.equal('CONTROL', 'last message control type');
    expect(lastMsg.SPCMD).to.equal(1, 'last message reset command');
    //
    winston.info({message: 'TEST: END program short:'});
	});


    //
    // test sequence of operations on download
    // using full file this time
    //
    // expect: sequence to start with sending of BOOTM opcode
    // expect: next, Hex file loaded, parsed & downloaded - verify by testing checksum of downloaded file if 'Complete' event received
    // expect: Last thing, expect reset command sent
    //
    it('program full test', async function() {
      winston.info({message: 'TEST: >>>>>> BEGIN: program full download:'});
      const programNode = require('../VLCB-server/programNodeMMC.js')
      programNode.setConnection(NET_ADDRESS, NET_PORT)
      programNode.on('programNode_progress', function (data) {
        downloadData = data;
        winston.warn({message: 'TEST: full download: ' + JSON.stringify(downloadData)});
      });	        
      var intelHexString = fs.readFileSync('./unit_tests/test_firmware/CANACC5_v2v.HEX');
//      var intelHexString = fs.readFileSync('./unit_tests/test_firmware/CANACE8C_v2q.HEX');
//      var intelHexString = fs.readFileSync('./unit_tests/test_firmware/CANMIO3d-18F26k80-16MHz.HEX');
//      var intelHexString = fs.readFileSync('./unit_tests/test_firmware/Universal-VLCB4a4-18F26K80-16MHz.HEX');
//      var intelHexString = fs.readFileSync('./unit_tests/test_firmware/Universal-VLCB4a4-18F27Q83-16MHz.HEX');
      await programNode.program(300, 1, 4, intelHexString);
      var FIRMWARE = programNode.FIRMWARE
      programNode.removeAllListeners()
    //
      // expect first message to be BOOTM
      var firstMsg = cbusLib.decode(mock_jsonServer.messagesIn[0])
      winston.debug({message: 'TEST: full download: first message: ' + firstMsg.text});
      expect(firstMsg.ID_TYPE).to.equal('S', 'first message ID_TYPE');
      expect(firstMsg.opCode).to.equal('5C', 'first message BOOTM 5C');
      //
      // verify checksum when process is signalled as complete
      expect(downloadData.status).to.equal('Success', 'Download status');
      expect(downloadData.text).to.equal('Success: programing completed', 'Download event');
      //
      // check last message is a reset command
      var lastMsg = cbusLib.decode(mock_jsonServer.messagesIn[mock_jsonServer.messagesIn.length - 1])
      winston.debug({message: 'TEST: full download: last message: ' + lastMsg.text});
      expect(lastMsg.ID_TYPE).to.equal('X', 'last message ID_TYPE');
      expect(lastMsg.type).to.equal('CONTROL', 'last message control type');
      expect(lastMsg.SPCMD).to.equal(1, 'last message reset command');
      //

      for (const block in FIRMWARE.FLASH) {
        winston.debug({message: 'TEST: full download: FLASH: ' + utils.decToHex(block, 6) + ' '})
        for (var i = 0; i<FIRMWARE.FLASH[block].length; i+=16){
          var output = utils.decToHex(parseInt(block) + i, 6) + ' '
          for (var j = 0; j<16; j++){output += utils.decToHex(FIRMWARE['FLASH'][block][i+j], 2) + ' ' }
          winston.debug({message: 'FLASH Data: ' + output})
        }
      }

      winston.info({message: 'TEST: END program full download:'});
    });
  
  

    it('program configOnly test', async function() {
      winston.info({message: 'TEST: BEGIN program short:'});
      const programNode = require('../VLCB-server/programNodeMMC.js')
      programNode.setConnection(NET_ADDRESS, NET_PORT)
      programNode.on('programNode_progress', function (data) {
        downloadData = data;
        winston.warn({message: 'TEST: short download: ' + JSON.stringify(downloadData)});
      });	        
      var intelHexString = fs.readFileSync('./unit_tests/test_firmware/configOnly.HEX');
      await programNode.program(3000, 1, 5, intelHexString);
      programNode.removeAllListeners()
      //
      //
      // expect first message to be BOOTM
      var firstMsg = cbusLib.decode(mock_jsonServer.messagesIn[0])
      winston.info({message: 'TEST: short download: first message: ' + JSON.stringify(firstMsg)});
      expect(firstMsg.ID_TYPE).to.equal('S', 'first message ID_TYPE');
      expect(firstMsg.opCode).to.equal('5C', 'first message BOOTM 5C');
      //
      //
      // verify checksum when process is signalled as complete
      expect(downloadData.status).to.equal('Success', 'Download event');
      expect(downloadData.text).to.equal('Success: programing completed', 'Download event');
  //    expect(mock_jsonServer.firmwareChecksum).to.equal('C68E', 'Checksum');
      //
      // check last message is a reset command
      winston.info({message: 'TEST: short download: number of message: ' + mock_jsonServer.messagesIn.length});
      var lastMsg = mock_jsonServer.messagesIn[mock_jsonServer.messagesIn.length - 1]
      winston.info({message: 'TEST: short download: last message: ' + JSON.stringify(lastMsg)});
      var lastMsg = cbusLib.decode(lastMsg)
      winston.debug({message: 'TEST: short download: last message: ' + lastMsg.text});
      expect(lastMsg.ID_TYPE).to.equal('X', 'last message ID_TYPE');
      expect(lastMsg.type).to.equal('CONTROL', 'last message control type');
      expect(lastMsg.SPCMD).to.equal(1, 'last message reset command');
      //
      winston.info({message: 'TEST: END program short:'});
    });
  
  
    it('program eepromOnly test', async function() {
      winston.info({message: 'TEST: BEGIN program short:'});
      const programNode = require('../VLCB-server/programNodeMMC.js')
      programNode.setConnection(NET_ADDRESS, NET_PORT)
      programNode.on('programNode_progress', function (data) {
        downloadData = data;
        winston.warn({message: 'TEST: short download: ' + JSON.stringify(downloadData)});
      });	        
      var intelHexString = fs.readFileSync('./unit_tests/test_firmware/eepromOnly.HEX');
      await programNode.program(3000, 1, 6, intelHexString);
      programNode.removeAllListeners()
      //
      //
      // expect first message to be BOOTM
      var firstMsg = cbusLib.decode(mock_jsonServer.messagesIn[0])
      winston.info({message: 'TEST: short download: first message: ' + JSON.stringify(firstMsg)});
      expect(firstMsg.ID_TYPE).to.equal('S', 'first message ID_TYPE');
      expect(firstMsg.opCode).to.equal('5C', 'first message BOOTM 5C');
      //
      //
      // verify checksum when process is signalled as complete
      expect(downloadData.status).to.equal('Success', 'Download event');
      expect(downloadData.text).to.equal('Success: programing completed', 'Download event');
  //    expect(mock_jsonServer.firmwareChecksum).to.equal('C68E', 'Checksum');
      //
      // check last message is a reset command
      winston.info({message: 'TEST: short download: number of message: ' + mock_jsonServer.messagesIn.length});
      var lastMsg = mock_jsonServer.messagesIn[mock_jsonServer.messagesIn.length - 1]
      winston.info({message: 'TEST: short download: last message: ' + JSON.stringify(lastMsg)});
      var lastMsg = cbusLib.decode(lastMsg)
      winston.debug({message: 'TEST: short download: last message: ' + lastMsg.text});
      expect(lastMsg.ID_TYPE).to.equal('X', 'last message ID_TYPE');
      expect(lastMsg.type).to.equal('CONTROL', 'last message control type');
      expect(lastMsg.SPCMD).to.equal(1, 'last message reset command');
      //
      winston.info({message: 'TEST: END program short:'});
    });
  
  
      //
    // test rejection of corrupted file
    // use shortened file to save time, as we've already tested parsing full hex file above
    //
    // expect: sequence to start with sending of BOOTM opcode
    // expect: next, Hex file loaded, parsed & downloaded - verify by testing checksum of downloaded file if 'Complete' event received
    // expect: Last thing, expect reset command sent
    //
	it('Download corrupt file test', async function() {
		winston.info({message: 'TEST: >>>>>> BEGIN: corrupt download:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    var corruptFileData
    programNode.on('programNode_progress', function (data) {
      corruptFileData = data;
		  winston.warn({message: 'TEST: corrupt download: ' + JSON.stringify(corruptFileData)});
		});	        
    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/corruptFile.HEX');
		await programNode.program(300, 1, 3, intelHexString);
    programNode.removeAllListeners()
    //
    expect (mock_jsonServer.messagesIn.length).to.equal(0, "check sent messages")
    expect(corruptFileData.status).to.equal("Failure", 'Download event');
    expect(corruptFileData.text).to.equal("Failed: file parsing failed", 'Download event');
    //
    winston.info({message: 'TEST: <<<<<< END: corrupt download:'});
	});


  
  function GetTestCase_CPU_TYPE() {
    var arg1, arg2, arg3, testCases = [];
    for (var a = 1; a<= 3; a++) {
      if (a == 1) {arg1 = 1, arg2 = 'Success', arg3 = "./unit_tests/test_firmware/shortFile.HEX"}
      if (a == 2) {arg1 = 23, arg2 = 'Success', arg3 = "./unit_tests/test_firmware/shortFile_type23.HEX"}
      if (a == 3) {arg1 = 23, arg2 = 'Failure', arg3 = "./unit_tests/test_firmware/shortFile.HEX"}
      testCases.push({'cpuType':arg1, 'result':arg2, 'hexFile':arg3});
    }
    return testCases;
  }


    //
    // use wrong cpu type, and short file
    //
    itParam("CPUTYPE test ${JSON.stringify(value)}", GetTestCase_CPU_TYPE(), async function (value) {
		winston.info({message: 'TEST: BEGIN: CPUTYPE file:' + JSON.stringify(value)});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    programNode.on('programNode_progress', function (data) {
			downloadData = data;
			winston.warn({message: 'TEST: CPUTYPE: ' + JSON.stringify(downloadData)});
    });	        
    var intelHexString = fs.readFileSync(value.hexFile);
		await programNode.program(300, value.cpuType, 0, intelHexString);
    programNode.removeAllListeners()
    //
    expect(downloadData.status).to.equal(value.result, 'Download event');
    if(value.result == 'Failure'){
      expect(downloadData.text).to.equal('CPU mismatch', 'Download event');
    }
    //
    winston.info({message: 'TEST: END: CPUTYPE:'});
	});



    //
    // use wrong cpu type, and short file
    //
	it('CPUTYPE ignore test', async function() {
		winston.info({message: 'TEST: >>>>>> BEGIN: ignore CPUTYPE:'});
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)
    downloadDataArray = []
    programNode.on('programNode_progress', function (data) {
			downloadDataArray.push(data);
			winston.warn({message: 'TEST: ignore CPUTYPE: ' + JSON.stringify(data)});
    });	        
    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/shortFile.HEX');
		await programNode.program(300, 99, 4, intelHexString);
    programNode.removeAllListeners()
    //
    expect(downloadDataArray[1].text).to.equal('CPUTYPE ignored', 'Download event');
    expect(downloadDataArray[downloadDataArray.length-1].status).to.equal('Success', 'Download event');
    expect(downloadDataArray[downloadDataArray.length-1].text).to.equal('Success: programing completed', 'Download event');
    //
    winston.info({message: 'TEST: <<<<<< END: ignore CPUTYPE:'});
	});



    //
    // test sequence of operations on program boot mode
    // use shortened file to save time, as we've already tested parsing full hex file above
    //
    // expect: module is already in boot mode, so doesn't need boot command, and onlt expects firmware, so won't respond to any other opcodes
    // expect: next, Hex file loaded, parsed & downloaded - verify by testing checksum of downloaded file if 'Complete' event received
    // expect: Last thing, expect reset command sent
    //
	it('programBootMode test', async function() {
		winston.info({message: 'TEST: >>>>>> BEGIN: programBootMode:'});
    mock_jsonServer.firmware = []   // don't have a change to boot mode to reset captured firmware
    mock_jsonServer.ackRequested = true
    const programNode = require('../VLCB-server/programNodeMMC.js')
    programNode.setConnection(NET_ADDRESS, NET_PORT)

    programNode.on('programNode_progress', function (data) {
			downloadData = data;
			winston.warn({message: 'TEST: programBootMode: ' + JSON.stringify(downloadData)});
    });	        
    var intelHexString = fs.readFileSync('./unit_tests/test_firmware/shortFile.HEX');
		await programNode.program(1, 1, 11, intelHexString);
    programNode.removeAllListeners()
      //
      // verify process is signalled as complete & checksum correct
      expect(downloadData.status).to.equal("Success", 'programBootMode: expected event');
      expect(downloadData.text).to.equal('Success: programing completed', 'Download event');
//      expect(mock_jsonServer.firmwareChecksum).to.equal('C68E', 'Checksum');
      //
      // check last message is a reset command
      var lastMsg = cbusLib.decode(mock_jsonServer.messagesIn[mock_jsonServer.messagesIn.length - 1])
			winston.debug({message: 'TEST: programBootMode: last message: ' + lastMsg.text});
      expect(lastMsg.ID_TYPE).to.equal('X', 'last message ID_TYPE');
      expect(lastMsg.type).to.equal('CONTROL', 'last message control type');
      expect(lastMsg.SPCMD).to.equal(1, 'last message reset command');
      //
      winston.info({message: 'TEST: <<<<<< END: programBootMode:'});
	});


})