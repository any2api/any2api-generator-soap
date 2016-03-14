const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const path = require('path');
const async = require('async');
const _ = require('lodash');
const soap = require('soap');
const uuid = require('uuid');
const testssh = require('any2api-testssh');



process.env.PORT = process.env.PORT || 3000;
process.env.BASE_ADDRESS = process.env.BASE_ADDRESS || 'http://localhost:' + process.env.PORT;
const baseUrl = process.env.BASE_ADDRESS + '/?wsdl';
const containerHost = process.env.CONTAINER_HOST || 'localhost';
const containerPort = process.env.CONTAINER_PORT || 2222;
const containerName = 'testssh-' + uuid.v4();

const timeout = 10 * 60 * 1000; // 10mins

const app = require('../app');

var appListening = false;
app.on('listening', () => { appListening = true });



describe('minimum test:', function() {
  this.timeout(timeout);

  const endpoints = [];

  before('identify endpoints of executables', done => {
    fs.readFile(path.resolve(__dirname, '..', 'apispec.json'), 'utf8', (err, content) => {
      if (err) throw err;

      const apiSpec = JSON.parse(content);

      _.each(apiSpec.executables, (executable, name) => {
        endpoints.push({
          service: executable.wsdl_service_name,
          port: executable.wsdl_port_name,
          operation: executable.wsdl_name + 'Invoke'
        });
      });

      done();
    });
  });

  it('run executables locally with default parameters', function(done) {
    const input = {};

    if (appListening) makeRequests(endpoints, input, done);
    else app.on('listening', () => makeRequests(endpoints, input, done));
  });

  it('run executables remotely with default parameters: ssh://' + containerHost + ':' + containerPort, function(done) {
    const input = {
      parameters: {
        invokerConfig: { // JSON.stringify (because this is actually JSON payload)
          access: 'ssh',
          ssh_port: containerPort,
          ssh_host: containerHost,
          ssh_user: testssh.username,
          ssh_private_key: testssh.privateKey
        }
      }
    };

    async.series([
      done => {
        testssh.startContainer(containerName, containerPort, done);
      },
      done => {
        if (appListening) makeRequests(endpoints, input, done);
        else app.on('listening', () => makeRequests(endpoints, input, done));
      }
    ], done);
  });

  after('stop app', function(done) {
    testssh.stopContainer(containerName, done);

    app.close(err => {
      if (err) throw err;

      done();
    });
  });
});



const makeRequests = (endpoints, input, done) => {
  async.eachSeries(endpoints, (endpoint, done) => {
    soap.createClient(baseUrl, {
      wsdl_options: { rejectUnauthorized: false },
      timeout: timeout
    }, (err, client) => {
      client[endpoint.service][endpoint.port][endpoint.operation](input, (err, output) => {
        if (err) return done(err);

        console.log(output);

        expect(output.results).to.exist;
        expect(output.instance.id).to.exist;
        expect(output.instance.finished).to.exist;
        expect(output.instance.status).to.equal('finished');

        done();
      });
    });
  }, (err) => {
    if (err) throw err;

    done();
  });
};
