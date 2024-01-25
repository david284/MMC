const expect = require('chai').expect;
const itParam = require('mocha-param');
const winston = require('./config/winston_test.js')
const fs = require('fs');
const jsonfile = require('jsonfile')


// Scope:
// variables declared outside of the class are 'global' to this module only
// callbacks need a bind(this) option to allow access to the class members
// let has block scope (or global if top level)
// var has function scope (or global if top level)
// const has block scope (like let), but can't be changed through reassigment or redeclared

const expectedConfigPath = ".\\unit_tests\\test_output\\config"
// delete existing configs..
fs.rmSync(expectedConfigPath, { recursive: true, force: true });

const config = require('../VLCB-server/configuration.js')(expectedConfigPath)

describe('configuration tests', function(){


	before(function(done) {
		winston.info({message: ' '});
		winston.info({message: '================================================================================'});
    //                      12345678901234567890123456789012345678900987654321098765432109876543210987654321
		winston.info({message: '------------------------------ configuration tests ------------------------------'});
		winston.info({message: '================================================================================'});
		winston.info({message: ' '});
		done();
    //
    // Use local 'user' directory for tests...
    config.userConfigPath = ".\\unit_tests\\test_output\\test_user"
	});

	beforeEach(function() {
    winston.info({message: ' '});   // blank line to separate tests
    winston.info({message: ' '});   // blank line to separate tests
        // ensure expected CAN header is reset before each test run
	});

	after(function() {
   		winston.info({message: ' '});   // blank line to separate tests
	});																										


  //****************************************************************************************** */
  //
  // Actual tests after here...
  //
  //****************************************************************************************** */  

  //
  it("configPath test", function () {
    winston.info({message: 'unit_test: BEGIN configPath test '});
    result = config.getConfigPath();
    winston.info({message: 'result: ' + result});
    expect(result).to.equal(expectedConfigPath);
    winston.info({message: 'unit_test: END configPath test'});
  })


  //
  it("currentLayoutFolder", function () {
    winston.info({message: 'unit_test: BEGIN currentLayoutFolder test '})
    var testFolder = 'new_layout'
    result = config.setCurrentLayoutFolder(testFolder)
    winston.info({message: 'result: ' + config.getCurrentLayoutFolder()})
    expect(config.getCurrentLayoutFolder()).to.equal(testFolder)
    winston.info({message: 'unit_test: END currentLayoutFolder test'})
  })


  //
  it("readLayoutDetails", function (done) {
    winston.info({message: 'unit_test: BEGIN readLayoutDetails test '})
    result = config.readLayoutDetails()
    setTimeout(function(){
      winston.info({message: 'result: ' + JSON.stringify(result)})
      expect(result).to.have.property('layoutDetails')
      winston.info({message: 'unit_test: END readLayoutDetails test'})
        done();
		}, 50);
  })

  function GetTestCase_layout() {
    var arg1, testCases = [];
    for (var a = 1; a<= 3; a++) {
      if (a == 1) {arg1 = "write_test1"}
      if (a == 2) {arg1 = "write_test2"}
      if (a == 3) {arg1 = "write_test3"}
      testCases.push({'layout':arg1});
    }
    return testCases;
  }

  //
  itParam("writeLayoutDetails test ${JSON.stringify(value)}", GetTestCase_layout(), function (done, value) {
    winston.info({message: 'unit_test: BEGIN writeLayoutDetails test '})
    var data = {
      "layoutDetails": {
        "title": value.layout + " layout",
        "subTitle": "layout auto created",
        "nextNodeId": 800
      },
      "nodeDetails": {},
      "eventDetails": {}
    }
    result = config.setCurrentLayoutFolder("write_test")
    config.writeLayoutDetails(data)
    result = config.readLayoutDetails()
    setTimeout(function(){
      winston.info({message: 'result: ' + JSON.stringify(result)})
      expect(result.layoutDetails.title).to.equal(value.layout + " layout");
      winston.info({message: 'unit_test: END writeLayoutDetails test'})
        done();
		}, 50);
  })


  function GetTestCase_node(){
    var arg1, testCases = [];
    for (var a = 1; a<= 3; a++) {
      if (a == 1) {arg1 = 0}
      if (a == 2) {arg1 = 1}
      if (a == 3) {arg1 = 65535}
      testCases.push({'nodeNumber':arg1});
    }
    return testCases;
  }

  //
  itParam("writeNodeConfig test ${JSON.stringify(value)}", GetTestCase_node(), function (done, value) {
    winston.info({message: 'unit_test: BEGIN writeNodeConfig test '})
    var data = {
      "nodes": {
        "301": {
          "nodeNumber": value.nodeNumber
        }
      }
    }
    config.writeNodeConfig(data)
    result = config.readNodeConfig()
    setTimeout(function(){
      winston.info({message: 'result: ' + JSON.stringify(result)})
      expect(result.nodes["301"].nodeNumber).to.equal(value.nodeNumber);
      winston.info({message: 'unit_test: END writeNodeConfig test'})
        done();
		}, 50);
  })

  //
  it("readMergConfig test", function (done) {
    winston.info({message: 'unit_test: BEGIN readMergConfig test '})
    var result = config.readMergConfig()
    setTimeout(function(){
      winston.info({message: 'result: ' + JSON.stringify(result)})
      expect(result).to.have.property('modules')
      winston.info({message: 'unit_test: END readMergConfig test'})
        done();
		}, 50);
  })


  //
  it("readServiceDefinitions test", function (done) {
    winston.info({message: 'unit_test: BEGIN readServiceDefinitions test '})
    var result = config.readServiceDefinitions()
    setTimeout(function(){
      winston.info({message: 'result length: ' + JSON.stringify(result).length})
      expect(JSON.stringify(result).length).to.be.greaterThan(3)
      winston.info({message: 'unit_test: END readServiceDefinitions test'})
        done();
		}, 50);
  })


  function GetTestCase_readModuleDescriptor() {
    var arg1, arg2, testCases = [];
    for (var a = 1; a<= 3; a++) {
      if (a == 1) {arg1 = "test#1", arg2 = 'pass', arg3 = 1}
      if (a == 2) {arg1 = "test#2", arg2 = 'pass', arg3 = 2}
      if (a == 3) {arg1 = "test#3", arg2 = 'fail', arg3 = 3}
      testCases.push({'file':arg1, 'result':arg2, 'testNumber':arg3});
    }
    return testCases;
  }

  // test Aims
  // add test file #1 to test 'user' module folder
  // retrieve said file & check it's the same
  // add test file #2 to 'system' module folder (but not 'user' folder)
  // retrieve said file & check it's the same
  // attempt to retrieve non-existant file and chek it fails
  //
  itParam("readModuleDescriptor test ${JSON.stringify(value)}", GetTestCase_readModuleDescriptor(), function (done, value) {
    winston.info({message: 'unit_test: BEGIN readModuleDescriptor test ' + JSON.stringify(value)})
    var testPattern = {"test":value.testNumber}
    if (value.testNumber == 1){
      // ensure 'user' modules directory exists
      config.createDirectory(config.userConfigPath + "\\modules")
      jsonfile.writeFileSync(
        config.userConfigPath + "\\modules\\" + value.file,
        testPattern,
        {spaces: 2, EOL: '\r\n'})
    }
    if (value.testNumber == 2){
      // ensure 'system' modules directory exists
      config.createDirectory(config.configPath + "\\modules")
      jsonfile.writeFileSync(
        config.configPath + "\\modules\\" + value.file,
        testPattern,
        {spaces: 2, EOL: '\r\n'})
    }
    var file = config.readModuleDescriptor(value.file)
    setTimeout(function(){
      if (file) {
        winston.info({message: 'result length: ' + JSON.stringify(file).length})
        expect(JSON.stringify(file).length).to.be.greaterThan(3)
        expect(value.result).to.be.equal('pass')
        expect (file.toString()).to.be.equal(testPattern.toString())
      } else {
        expect(value.result).to.be.equal('fail')
      }
      winston.info({message: 'unit_test: END readModuleDescriptor test'})
      done();
		}, 50);
  })

  
  //
  it("getLayoutList test ${JSON.stringify(value)}", function () {
    winston.info({message: 'unit_test: BEGIN getLayoutList test '})
    result = config.getListOfLayouts()
    winston.info({message: 'result: ' + result})
//    expect(config.getCurrentLayoutFolder()).to.equal(testFolder)
    winston.info({message: 'unit_test: END getLayoutList test'})
  })


  function GetTestCase_port() {
    var arg1, arg2, testCases = [];
    for (var a = 1; a<= 3; a++) {
      if (a == 1) {arg1 = 0}
      if (a == 2) {arg1 = 1}
      if (a == 3) {arg1 = 65535}
      testCases.push({'port':arg1});
    }
    return testCases;
  }

  //
  itParam("cbusServerPort test ${JSON.stringify(value)}", GetTestCase_port(), function (value) {
    winston.info({message: 'unit_test: BEGIN cbusServerPort test '});
    config.setCbusServerPort(value.port);
    result = config.getCbusServerPort();
    winston.info({message: 'result: ' + result});
    expect(result).to.equal(value.port);
    winston.info({message: 'unit_test: END cbusServerPort test'});
  })

  //
  itParam("jsonServerPort test ${JSON.stringify(value)}", GetTestCase_port(), function (value) {
    winston.info({message: 'unit_test: BEGIN jsonServerPort test '});
    config.setJsonServerPort(value.port);
    result = config.getJsonServerPort();
    winston.info({message: 'result: ' + result});
    expect(result).to.equal(value.port);
    winston.info({message: 'unit_test: END jsonServerPort test'});
  })

  //
  itParam("socketServerPort test ${JSON.stringify(value)}", GetTestCase_port(), function (value) {
    winston.info({message: 'unit_test: BEGIN socketServerPort test '});
    config.setSocketServerPort(value.port);
    result = config.getSocketServerPort();
    winston.info({message: 'result: ' + result});
    expect(result).to.equal(value.port);
    winston.info({message: 'unit_test: END socketServerPort test'});
  })


})