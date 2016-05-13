const path = require('path');
const url = require('url');
const fs = require('fs');
const uuid = require('uuid');
const async = require('async');
const _ = require('lodash');
const S = require('string');
const pkg = require('./package.json');
const debug = require('debug')(pkg.name);
const http = require('http');
const soap = require('soap');
const shortId = require('shortid');

const util = require('any2api-util');

const preInvokeCode = process.env.PRE_INVOKE || '';
const preInvokeTplPath = path.join(__dirname, 'pre-invoke.js.tpl');
const preInvokeScrPath = path.join(__dirname, 'pre-invoke.js');
fs.writeFileSync(preInvokeScrPath, _.template(fs.readFileSync(preInvokeTplPath, 'utf8'))({ code: preInvokeCode }), 'utf8');
const preInvoke = require('./pre-invoke');

const authToken = process.env.AUTH_TOKEN;

const apiPort = process.env.PORT || 3000;
const baseAddress = process.env.BASE_ADDRESS || 'http://0.0.0.0:' + apiPort;
const timeout = process.env.TIMEOUT || 20 * 60 * 1000; // 20mins
const registerOnFinish = JSON.parse(process.env.REGISTER_ONFINISH || 'false');



const rawWsdl = fs.readFileSync(path.resolve(__dirname, 'spec.wsdl'), 'utf8');
const wsdl = rawWsdl.replace(/{{baseAddress}}/g, baseAddress);

var apiSpec;

//TODO: use any2api-instancedb-redis



var invoke = function(input, executableName, invokerName, callback) {
  input = input || {};

  var instance = input.instance || {};
  instance.id = instance.id || uuid.v4();
  instance.timeout = instance.timeout || timeout;

  var parameters = {};

  var paramsStream = null;
  var resultsStream = util.throughStream({ objectMode: true });

  var executable = apiSpec.executables[executableName];
  var invoker = apiSpec.invokers[invokerName];

  var item = executable || invoker;

  var output = { instance: instance, results: {} };

  async.series([
    function(callback) {
      // Map parameters
      async.eachSeries(_.keys(input.parameters), function(wsdlName, callback) {
        if (input.parameters[wsdlName] && input.parameters[wsdlName]['$value']) {
          input.parameters[wsdlName] = input.parameters[wsdlName]['$value'];
        }

        var name = item.wsdlParamsMap[wsdlName];
        var value = input.parameters[wsdlName];
        var paramDef = item.parameters_schema[name];

        if (!paramDef) return callback();

        paramDef.type = paramDef.type || '';

        if (_.includes(paramDef.type.toLowerCase(), 'json') && _.isString(value)) {
          try {
            parameters[name] = JSON.parse(value);
          } catch (err) {
            err.soapText = 'Parameter value ' + name + ' is not valid JSON: ';
            err.soapText += err.message || err.toString();

            return callback(err);
          }
        } else {
          parameters[name] = value;
        }

        callback();
      }, callback);
    },
    function(callback) {
      preInvoke(instance, parameters, executable, invoker, function(err, inst, params) {
        debug('preInvoke instance', instance);

        instance = inst || instance;
        parameters = params || parameters;

        callback(err);
      });
    },
    function(callback) {
      // Build parameters stream
      util.streamifyParameters({
        parameters: parameters,
        parametersSchema: item.parameters_schema,
        parametersRequired: item.parameters_required
      }, function(err, stream) {
        paramsStream = stream;

        callback(err);
      });
    },
    function(callback) {
      // Run instance
      util.runInstance({
        apiSpec: apiSpec,
        instance: instance,
        executableName: executableName,
        invokerName: invokerName,
        parametersStream: paramsStream,
        resultsStream: resultsStream
      }, function(err, inst) {
        instance = inst;

        callback(err);
      });
    }
  ], function(err) {
    if (err) return callback(err, output);

    // Consume results stream
    util.unstreamifyResults({
      resultsSchema: item.results_schema,
      resultsStream: resultsStream
    }, function(err2, results) {
      if (err2) console.error('unstreamifyResults error', err2);

      // Map results
      _.each(results, function(value, name) {
        var resultDef = item.results_schema[name] || {};
        resultDef.type = resultDef.type || '';

        var wsdlName = resultDef.wsdl_name || S(name).camelize().stripPunctuation().s;
        //wsdlName = S(name).camelize().replace(/\//g, '_').replace(/\\\\/g, '_').replace(/\\/g, '_').s;
        //if (S(wsdlName).startsWith('_')) wsdlName = wsdlName.substring(1);
        //name.replace(/\//g, '_').replace(/\\\\/g, '_').replace(/\\/g, '_').replace(/[^\w\s]|_/g, ' ').replace(/\s+/g, ' ');

        if (output.results[wsdlName]) wsdlName += '_' + shortId.generate();

        // Remove control characters
        if (_.isString(value)) value = value.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

        if (_.includes(resultDef.type.toLowerCase(), 'json')) {
          output.results[wsdlName] = { '$value': JSON.stringify(value, null, 2) };
        } else if (/*_.includes(resultDef.type.toLowerCase(), 'binary') &&*/ Buffer.isBuffer(value)) {
          output.results[wsdlName] = { '$value': value.toString('base64') };
        } else if (_.includes(resultDef.type.toLowerCase(), 'xml')) {
          output.results[wsdlName] = { '$xml': value };
        } else {
          output.results[wsdlName] = { '$value': value };
        }

        output.results[wsdlName].attributes = { resultName: _.escape(name) };
      });

      callback(null, output);
    });
  });
};

var toSoapError = function(err) {
  console.error('SOAP error', err);

  return {
    Fault: {
      Code: {
        Value: "soap:Sender"
        //, Subcode: { value: "soap:Error" }
      },
      Reason: { Text: err.soapText || err.message || err.toString() },
      statusCode: 500
    }
  };
};



// Initialize server
var server = http.createServer(function(req, res) {
  var parsedUrl = url.parse(req.url);

  if (parsedUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/xml' });

    var tailoredWsdl = wsdl;

    if (!process.env.SOAP_BASE_ADDRESS) {
      tailoredWsdl = rawWsdl.replace(/{{baseAddress}}/g, 'http://' + req.headers.host);
    }

    res.write(tailoredWsdl);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });

    res.write('Not Found: ' + req.url);
  }

  res.end();
});

server.setTimeout(timeout);
server.log = console.log;
server.on('error', function(err) {
  if (err) throw err;
});
//soap.listen(server, '/', port, wsdl);



// Read API spec
util.readSpec({ specPath: path.join(__dirname, 'apispec.json') }, function(err, as) {
  if (err) throw err;

  apiSpec = as;

  // Initialize endpoints defined by WSDL ports
  _.each([ 'executables', 'invokers' ], function(collection) {
    _.each(apiSpec[collection], function(item, name) {
      const context = { executableName: null, invokerName: null };

      if (collection === 'executables') context.executableName = name;
      else if (collection === 'invokers') context.invokerName = name;

      item.wsdlParamsMap = {};

      _.each(item.parameters_schema, function(param, name) {
        item.wsdlParamsMap[param.wsdl_name] = name;
      });

      const port = {};
      port[item.wsdl_service_name] = {};
      port[item.wsdl_service_name][item.wsdl_port_name] = {};

      port[item.wsdl_service_name][item.wsdl_port_name][item.wsdl_name + 'Invoke'] = function(input, callback, headers) {
        debug(item.wsdl_name + 'Invoke', 'input', input);

        input = input || {};
        headers = headers || {};

        const token = input.token || headers.token;

        if (authToken && token !== authToken) throw toSoapError(new Error('invalid token'));

        invoke(input, context.executableName, context.invokerName, function(err, output) {
          //if (err) throw toSoapError(err);
          if (err) return callback(toSoapError(err));

          debug(item.wsdl_name + 'Invoke', 'output', output);

          callback(output);
        });
      };

      port[item.wsdl_service_name][item.wsdl_port_name][item.wsdl_name + 'InvokeAsync'] = function(input, callback, headers) {
        debug(item.wsdl_name + 'InvokeAsync', 'input', input);

        input = input || {};
        headers = headers || {};

        const token = input.token || headers.token;
        const callbackUrl = input.callback || headers.callback;

        if (authToken && token !== authToken) throw toSoapError(new Error('invalid token'));
        else if (!callbackUrl) throw toSoapError(new Error('callback URL missing'));

        invoke(input, context.executableName, context.invokerName, function(err, output) {
          if (err) return console.error(item.wsdl_name + 'InvokeAsync error', err);

          debug(item.wsdl_name + 'InvokeAsync', 'output', output);

          soap.createClient(callbackUrl + '?wsdl', {
            endpoint: callbackUrl
          }, function(err, client) {
            if (err) return console.error(item.wsdl_name + 'InvokeOnFinish createClient error', err);

            const onFinish = client[item.wsdl_cb_service_name][item.wsdl_cb_port_name][item.wsdl_name + 'InvokeOnFinish'];

            onFinish(output, function(err, result) {
              if (err) return console.error(item.wsdl_name + 'InvokeOnFinish client request error', err);
            });
          });
        });

        callback();
      };

      soap.listen(server, '/' + item.wsdl_url_path, port, wsdl);

      // Callback endpoints for testing
      if (registerOnFinish) {
        const cbUrl = '/' + item.wsdl_name + 'Callback';
        const cbWsdl = wsdl.replace('http://[host]:[port]' + cbUrl, baseAddress + cbUrl);

        const cbPort = {};
        cbPort[item.wsdl_cb_service_name] = {};
        cbPort[item.wsdl_cb_service_name][item.wsdl_cb_port_name] = {};

        cbPort[item.wsdl_cb_service_name][item.wsdl_cb_port_name][item.wsdl_name + 'InvokeOnFinish'] = function(input, callback, headers) {
          console.log(item.wsdl_name + 'InvokeOnFinish called', JSON.stringify(input, null, 2));

          callback();
        };

        soap.listen(server, cbUrl, cbPort, cbWsdl);

        console.log(item.wsdl_name + 'InvokeOnFinish operation registered: ' + cbUrl);
      }
    });
  });

  server.listen(apiPort, function(err) {
    if (err) throw err;
  });

  console.log('server listening on port ' + apiPort);
});



module.exports = server;
