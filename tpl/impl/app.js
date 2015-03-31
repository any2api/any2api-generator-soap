var path = require('path');
var url = require('url');
var fs = require('fs');
var uuid = require('uuid');
var S = require('string');
var async = require('async');
var _ = require('lodash');
var pkg = require('./package.json');
var debug = require('debug')(pkg.name);
var http = require('http');
var soap = require('soap');

var util = require('any2api-util');



var port = process.env.PORT || 3000;
var baseAddress = process.env.BASE_ADDRESS || 'http://0.0.0.0:' + port;
var timeout = process.env.TIMEOUT || 5 * 60 * 1000; // 5mins



var rawWsdl = fs.readFileSync(path.resolve(__dirname, 'spec.wsdl'), 'utf8');
var wsdl = rawWsdl.replace(/{{baseAddress}}/g, baseAddress);

var apiSpec;

//TODO: replace by Redis store
var instances = {};



var invoke = function(input, executableName, invokerName, callback) {
  input = input || {};

  var instance = input.instance || {};
  instance.id = uuid.v4();
  instance.parameters = {};

  var item = apiSpec.executables[executableName];
  if (!item) item = apiSpec.invokers[invokerName];

  //TODO: run util.persistEmbeddedExecutable _if_ invokerName && input.executable

  // Map parameters
  async.eachSeries(_.keys(input.parameters), function(wsdlName, callback) {
    var name = item.wsdlParamsMap[wsdlName];
    var value = input.parameters[wsdlName];
    var paramDef = item.parameters_schema[name];

    if (!paramDef) return callback();
    
    if (S(paramDef.type).toLowerCase().contains('json')) {
      try {
        instance.parameters[name] = JSON.parse(value);
      } catch (err) {
        err.soapText = 'Parameter value ' + name + 'is not valid JSON: ';
        err.soapText += err.message || err.toString();

        return callback(err);
      }
    } else {
      instance.parameters[name] = value;
    }

    callback();
  }, function(err) {
    if (err) return callback(err);

    debug('instance', instance);

    // Invoke executable
    util.invokeExecutable({ apiSpec: apiSpec,
                            instance: instance,
                            executable_name: executableName,
                            invoker_name: invokerName }, function(err, instance) {
      if (err) return callback(err);

      // Map results
      var output = { instance: instance, results: {} };

      _.each(instance.results, function(value, name) {
        var resultDef = item.results_schema[name];

        if (!resultDef) return;

        var wsdlName = item.results_schema[name].wsdl_name;
        
        if (S(resultDef.type).toLowerCase().contains('json')) {
          output.results[wsdlName] = JSON.stringify(value, null, 2);
        } else {
          output.results[wsdlName] = value;
        }
      });

      delete instance.parameters;
      delete instance.results;

      callback(null, output);
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
    res.setHeader('Content-Type', 'application/xml');

    var tailoredWsdl = wsdl;

    if (!process.env.BASE_ADDRESS) {
      tailoredWsdl = rawWsdl.replace(/{{baseAddress}}/g, 'http://' + req.headers.host);
    }

    res.write(tailoredWsdl);
  } else {
    res.write('404 Not Found: ' + req.url);
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
util.readInput({ specPath: path.join(__dirname, 'apispec.json') }, function(err, as) {
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
          debug('wsdl_name', item.wsdl_name);
          debug('input', input);
          debug('context', this);

          invoke(input, this.executableName, this.invokerName, function(err, output) {
            if (err) {
              err = toSoapError(err);

              throw err;
            }

            debug('output', output);

            callback(output);
          });
        }, context)
      };

      soap.listen(server, '/' + item.wsdl_service_name + '/' + item.wsdl_port_name, port, wsdl);
    });
  });

  server.listen(port, function(err) {
    if (err) throw err;
  });
});



module.exports = server;
