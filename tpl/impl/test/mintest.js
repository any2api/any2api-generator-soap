var chai = require('chai');
var expect = chai.expect;
var fs = require('fs');
var path = require('path');
var async = require('async');
var _ = require('lodash');
var soap = require('soap');



process.env.PORT = process.env.PORT || 3000;
process.env.BASE_ADDRESS = process.env.BASE_ADDRESS || 'http://localhost:' + process.env.PORT;
var baseUrl = process.env.BASE_ADDRESS + '/?wsdl';

process.env.TIMEOUT = process.env.TIMEOUT || 10 * 60 * 1000; // 10mins
var interval = process.env.INTERVAL || 1000 * 5; // 5 seconds

var app = require('../app');
var appListening = false;
app.on('listening', function() {
  appListening = true;
});

var input = {};

var options = {
  wsdl_options: {
    rejectUnauthorized: false,
    timeout: process.env.TIMEOUT
  }
};



describe('minimum test', function() {
  this.timeout(process.env.TIMEOUT);

  var endpoints = [];

  before('get executables', function(done) {
    fs.readFile(path.resolve(__dirname, '..', 'apispec.json'), 'utf8', function(err, content) {
      if (err) throw err;

      var apiSpec = JSON.parse(content);

      _.each(apiSpec.executables, function(executable, name) {
        endpoints.push({ service: executable.wsdl_service_name, port: executable.wsdl_port_name });
      });

      done();
    });
  });

  it('run executables with default parameters', function(done) {
    if (appListening) {
      performRequests(endpoints, done);
    } else {
      app.on('listening', function() {
        performRequests(endpoints, done);
      });
    }
  });

  after('stop app', function(done) {
    app.close(function(err) {
      if (err) throw err;

      done();
    });
  });
});



var performRequests = function(endpoints, done) {
  async.eachSeries(endpoints, function(endpoint, done) {
    soap.createClient(baseUrl, options, function(err, client) {
      client[endpoint.service][endpoint.port].invoke(input, function(err, output) {
        if (err) return done(err);

        console.log(output);

        expect(output.results).to.exist;
        expect(output.instance.id).to.exist;
        expect(output.instance.finished).to.exist;
        expect(output.instance.status).to.equal('finished');

        done();
      });
    });
  }, function(err) {
    if (err) throw err;

    done();
  });
};
