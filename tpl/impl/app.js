var path = require('path');
var url = require('url');
var fs = require('fs');
var uuid = require('uuid');
var async = require('async');
var _ = require('lodash');
var S = require('string');
var pkg = require('./package.json');
var debug = require('debug')(pkg.name);
var http = require('http');
var soap = require('soap');
var shortId = require('shortid');

var util = require('any2api-util');

var preInvokeCode = process.env.PRE_INVOKE || '';
var preInvokeTplPath = path.join(__dirname, 'pre-invoke.js.tpl');
var preInvokeScrPath = path.join(__dirname, 'pre-invoke.js');
fs.writeFileSync(preInvokeScrPath, _.template(fs.readFileSync(preInvokeTplPath, 'utf8'))({ code: preInvokeCode }), 'utf8');
var preInvoke = require('./pre-invoke');



var soapPort = process.env.PORT || 3000;
var baseAddress = process.env.BASE_ADDRESS || 'http://0.0.0.0:' + soapPort;
var timeout = process.env.TIMEOUT || 20 * 60 * 1000; // 20mins



var rawWsdl = fs.readFileSync(path.resolve(__dirname, 'spec.wsdl'), 'utf8');
var wsdl = rawWsdl.replace(/{{baseAddress}}/g, baseAddress);

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

        if (_.includes(paramDef.type.toLowerCase(), 'json')) {
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
      preInvoke(instance, executable, invoker, function(err, inst) {
        debug('instance', instance);

        instance = inst;

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
    // Consume results stream
    util.unstreamifyResults({
      resultsSchema: item.results_schema,
      resultsStream: resultsStream
    }, function(err2, results) {
      if (err2) console.error(err2);

      // Map results
      _.each(results, function(value, name) {
        var resultDef = item.results_schema[name] || {};
        resultDef.type = resultDef.type || '';

        var wsdlName = resultDef.wsdl_name || S(name).camelize().stripPunctuation().s;
        //wsdlName = S(name).camelize().replace(/\//g, '_').replace(/\\\\/g, '_').replace(/\\/g, '_').s;
        //if (S(wsdlName).startsWith('_')) wsdlName = wsdlName.substring(1);
        //name.replace(/\//g, '_').replace(/\\\\/g, '_').replace(/\\/g, '_').replace(/[^\w\s]|_/g, ' ').replace(/\s+/g, ' ');

        if (output.results[wsdlName]) wsdlName += '_' + shortId.generate();

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

      callback(err, output);
    });
  });
};

var toSoapError = function(err) {
  console.error(err);

  return {
    Fault: {
      Code: {
        Value: "soap:Sender"
        //, Subcode: { value: "soap:Error" }
      },
      Reason: { Text: err.soapText || err.message || err.toString() }
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
      var context = { executableName: null, invokerName: null };

      if (collection === 'executables') context.executableName = name;
      else if (collection === 'invokers') context.invokerName = name;

      item.wsdlParamsMap = {};

      _.each(item.parameters_schema, function(param, name) {
        item.wsdlParamsMap[param.wsdl_name] = name;
      });

      var port = {};
      port[item.wsdl_service_name] = {};
      port[item.wsdl_service_name][item.wsdl_port_name] = {
        invoke: _.bind(function(input, callback, headers) {
          debug('invoke', 'wsdl_name', item.wsdl_name);
          debug('invoke', 'input', input);
          debug('invoke', 'context', this);

          input = input || {};

          invoke(input, this.executableName, this.invokerName, function(err, output) {
            if (err) throw toSoapError(err);

            debug('invoke', 'output', output);

            callback(output);
          });
        }, context),
        invokeAsync: _.bind(function(input, callback, headers) {
          debug('invokeAsync', 'wsdl_name', item.wsdl_name);
          debug('invokeAsync', 'input', input);
          debug('invokeAsync', 'context', this);

          input = input || {};

          if (!input.callback) throw toSoapError(new Error('callback URL missing'));
          else if (!input.instance || !input.instance.id) throw toSoapError(new Error('instance ID missing'));

          invoke(input, this.executableName, this.invokerName, function(err, output) {
            if (err) return console.error(err);

            debug('invokeAsync', 'output', output);

            soap.createClient(input.callback + '?wsdl', {
              endpoint: input.callback
            }, function(err, client) {
              if (err) return console.error(err);

              client[item.wsdl_cb_service_name][item.wsdl_cb_port_name](output, function(err, result) {
                if (err) return console.error(err);
              });
            });
          });

          callback();
        }, context)
      };

      soap.listen(server, '/' + item.wsdl_url_path, port, wsdl);
    });
  });

  server.listen(soapPort, function(err) {
    if (err) throw err;
  });

  console.log('server listening on port ' + soapPort);
});



module.exports = server;
