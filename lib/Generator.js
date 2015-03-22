var path = require('path');
var fs = require('fs');
var shell = require('shelljs');
var async = require('async');
var _ = require('lodash');
var S = require('string');
var shortId = require('shortid');
var pretty = require('pretty-data').pd;
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
        if (implPath !== implTplPath) {
          shell.cp('-rf', implTplPath, implPath);
        }

        callback();
      },
      function(callback) {
        // Copy executables
        async.each(_.keys(apiSpec.executables), function(execName, callback) {
          var executable = apiSpec.executables[execName];
          var execPath = path.resolve(apiSpec.apispec_path, '..', executable.path);

          executable.path = path.join('executables', execName);

          shell.cp('-rf', execPath, path.resolve(implPath, executable.path));

          callback();
        }, callback);
      },
      function(callback) {
        // Copy invokers
        async.each(_.keys(apiSpec.invokers), function(invokerName, callback) {
          var invoker = apiSpec.invokers[invokerName];
          var invokerPath = path.resolve(apiSpec.apispec_path, '..', invoker.path);

          invoker.path = path.join('invokers', invokerName);

          shell.cp('-rf', invokerPath, path.resolve(implPath, invoker.path));

          callback();
        }, callback);
      },
      function(callback) {
        util.enrichSpec({ apiSpec: apiSpec, basePath: implPath }, callback);
      },
      function(callback) {
        apiSpec.implementation.wsdl_ns = apiSpec.implementation.wsdl_ns || 'urn:any2api:soap:' + shortId.generate();
        apiSpec.implementation.wsdl_ns_prefix = apiSpec.implementation.wsdl_ns_prefix || 'SOAP-API';
        apiSpec.implementation.wsdl_doc = ''; //TODO: implementation.title, implementation.description

        var names = [];

        var enrichSchema = function(schema, itemName) {
          _.each(schema, function(def, name) {
            if (def.wsdl_type_name && def.wsdl_type_ns_prefix && def.wsdl_name &&
                !_.includes(names, def.wsdl_name)) return;

            def.wsdl_name = def.wsdl_name || S(name).camelize().stripPunctuation().s;

            if (S(def.type).toLowerCase().contains('xml') && _.includes(names, def.wsdl_name)) {
              def.wsdl_name += S(shortId.generate()).capitalize().s;
            }

            names.push(def.wsdl_name);

            def.wsdl_doc = '';
            if (!_.isEmpty(def.description)) def.wsdl_doc += 'Description: ' + def.description + '\n\n';
            if (!_.isEmpty(def.default)) {
              if (S(def.type).toLowerCase().contains('json')) {
                def.wsdl_doc += 'Actual type: JSON\n\n';
                def.wsdl_doc += 'Default value: ' + JSON.stringify(def.default) + '\n\n';
              } else {
                def.wsdl_doc += 'Default value: ' + def.default + '\n\n';
              }
            }

            if (S(def.type).toLowerCase().contains('number')) {
              def.wsdl_type_name = 'decimal';
              def.wsdl_type_ns_prefix = 'xsd';
            } else if (S(def.type).toLowerCase().contains('boolean')) {
              def.wsdl_type_name = 'boolean';
              def.wsdl_type_ns_prefix = 'xsd';
            } else if (S(def.type).toLowerCase().contains('json')) {
              def.wsdl_type_name = 'string';
              def.wsdl_type_ns_prefix = 'xsd';

              if (!_.isEmpty(def.json_schema)) {
                def.wsdl_doc += 'JSON schema:\n' + JSON.stringify(def.json_schema, null, 2);
              }
            } else if (S(def.type).toLowerCase().contains('xml')) {
              def.wsdl_type_name = itemName + '_' + def.wsdl_name;
              def.wsdl_type_ns_prefix = apiSpec.implementation.wsdl_ns_prefix;

              def.xml_schema = def.xml_schema || '<xsd:any minOccurs="0" maxOccurs="unbounded"/>';
            } else {
              def.wsdl_type_name = 'string';
              def.wsdl_type_ns_prefix = 'xsd';
            }

            def.wsdl_doc = def.wsdl_doc.trim();

            if (_.isEmpty(def.wsdl_doc.trim())) delete def.wsdl_doc;
            //else def.wsdl_doc = S(def.wsdl_doc).escapeHTML().s;
          });
        };

        _.each([
          { collection: apiSpec.executables },
          { collection: apiSpec.invokers }
        ], function(c) {
          _.each(c.collection, function(item, name) {
            item.wsdl_name = item.wsdl_name || S(name).camelize().stripPunctuation().s;

            if (_.includes(names, item.wsdl_name)) {
              item.wsdl_name += S(shortId.generate()).capitalize().s;
            }

            names.push(item.wsdl_name);

            enrichSchema(item.parameters_schema, item.wsdl_name);
            enrichSchema(item.results_schema, item.wsdl_name);
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

          var prettyWsdlSpec = pretty.xml(wsdlSpec);

          fs.writeFile(path.resolve(implPath, 'spec.wsdl'), prettyWsdlSpec, callback);
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
