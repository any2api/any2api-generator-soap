var path = require('path');
var fs = require('fs-extra');
var async = require('async');
var _ = require('lodash');
var S = require('string');
var shortId = require('shortid');
var util = require('any2api-util');



module.exports = function(spec) {
  var obj = {};

  //spec = spec || {};

  var supports = function(apiSpec) {
    if (_.contains([ 'soap', 'wsdl', 'soap-wsdl' ], apiSpec.implementation.interface.trim().toLowerCase())) {
      return true;
    } else {
      return false;
    }
  };

  var generate = function(apiSpec, done) {
    var implPath = path.resolve(apiSpec.apispec_path, '..', apiSpec.implementation.path);

    var implTplPath = process.env.IMPL_TEMPLATE_PATH || path.resolve(__dirname, '..', 'tpl', 'impl');

    apiSpec.implementation.ports = [ '3000' ];

    async.series([
      function(callback) {
        if (implPath === implTplPath) return callback();
        
        fs.copy(implTplPath, implPath, callback);
      },
      function(callback) {
        // Copy executables
        async.each(_.keys(apiSpec.executables), function(execName, callback) {
          var executable = apiSpec.executables[execName];
          var execPath = path.resolve(apiSpec.apispec_path, '..', executable.path);

          executable.path = path.join('executables', execName);

          fs.copy(execPath, path.resolve(implPath, executable.path), callback);
        }, callback);
      },
      function(callback) {
        // Copy invokers
        async.each(_.keys(apiSpec.invokers), function(invokerName, callback) {
          var invoker = apiSpec.invokers[invokerName];
          var invokerPath = path.resolve(apiSpec.apispec_path, '..', invoker.path);

          invoker.path = path.join('invokers', invokerName);

          fs.copy(invokerPath, path.resolve(implPath, 'invokers', invokerName), callback);
        }, callback);
      },
      function(callback) {
        util.enrichSpec({ apiSpec: apiSpec, basePath: implPath }, callback);
      },
      function(callback) {
        apiSpec.implementation.wsdl_ns = apiSpec.implementation.wsdl_ns || 'urn:any2api:soap:' + shortId.generate();
        apiSpec.implementation.wsdl_ns_prefix = apiSpec.implementation.wsdl_ns_prefix || 'SOAP-API';
        apispec.implementation.wsdl_doc = ''; //TODO: implementation.title, implementation.description

        var enrichSchema = function(schema, portName, prefix) {
          _.each(schema, function(def, name) {
            if (def.wsdl_type_name && def.wsdl_type_ns_prefix) return;

            def.wsdl_type_doc = '';

            if (S(def.type).toLowerCase().contains('number')) {
              def.wsdl_type_name = 'decimal';
              def.wsdl_type_ns_prefix = 'xsd';
            } else if (S(def.type).toLowerCase().contains('boolean')) {
              def.wsdl_type_name = 'boolean';
              def.wsdl_type_ns_prefix = 'xsd';
            } else if (S(def.type).toLowerCase().contains('json')) {
              def.wsdl_type_name = 'string';
              def.wsdl_type_ns_prefix = 'xsd';

              if (def.description) def.wsdl_type_doc += 'Description: ' + def.description + '\n\n';
              if (def.default) def.wsdl_type_doc += 'Default: ' + def.default + '\n\n';

              if (def.json_schema) {
                def.wsdl_type_doc += 'JSON schema:\n' + encodeXml(JSON.stringify(def.json_schema, null, 2));
              }
            } else if (S(def.type).toLowerCase().contains('xml')) {
              def.wsdl_type_name = prefix + '_' + portName + '_' + S(name).camelize().s;
              def.wsdl_type_ns_prefix = apiSpec.implementation.wsdl_ns_prefix;

              def.xml_schema = def.xml_schema || '<xsd:any minOccurs="0" maxOccurs="unbounded"/>';
            } else {
              def.wsdl_type_name = 'string';
              def.wsdl_type_ns_prefix = 'xsd';
            }
          });
        };

        var portNames = [];

        _.each([
          { collection: apiSpec.executables, suffix: 'Executable' },
          { collection: apiSpec.invokers, suffix: 'Invoker' }
        ], function(c) {
          _.each(c.collection, function(item, name) {
            item.wsdl_port_name = item.wsdl_port_name || S(name).camelize().s;

            if (_.includes(portNames, item.wsdl_port_name)) {
              item.wsdl_port_name += c.suffix;
            } else if (_.includes(portNames, item.wsdl_port_name)) {
              item.wsdl_port_name += S(shortId.generate()).capitalize().s;
            }

            portNames.push(item.wsdl_port_name);

            enrichSchema(item.parameters_schema, item.wsdl_port_name, 'Parameter');
            enrichSchema(item.results_schema, item.wsdl_port_name, 'Result');
          });
        });

        var exposedInvokers = {};
        _.each(apiSpec.invokers, function(invoker, name) {
          if (invoker.expose) {
            exposedInvokers[name] = invoker;
          }
        });

        fs.readFile(path.resolve(__dirname, '..', 'tpl', 'spec.wsdl.tpl'), 'utf8', function(err, content) {
          var wsdlSpec = _.template(content)({
            executables: apiSpec.executables,
            invokers: exposedInvokers,
            implementation: apiSpec.implementation,
            executableTypeDef: util.embeddedExecutableSchemaXml
          });

          fs.writeFile(path.resolve(implPath, 'spec.wsdl'), wsdlSpec, callback);
        });
      }
    ], function(err) {
      if (err) return done(err);

      done(null, apiSpec);
    });
  };

  obj.generate = generate;
  obj.supports = supports;

  return obj;
};



var encodeXml = function(xml) {
  return xml.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
};
