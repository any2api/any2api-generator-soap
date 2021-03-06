var path = require('path');
var fs = require('fs-extra');
var async = require('async');
var _ = require('lodash');
var S = require('string');
var shortId = require('shortid');
var pretty = require('pretty-data').pd;
var util = require('any2api-util');

//TODO WORKAROUND
//fs.copy = function(src, dest, callback) { fs.copySync(src, dest); callback(); };



module.exports = function(spec) {
  var obj = {};

  //spec = spec || {};

  var supports = function(apiSpec) {
    if (_.includes([ 'soap', 'wsdl', 'soap-wsdl' ], apiSpec.implementation.interface.trim().toLowerCase())) {
      return true;
    } else {
      return false;
    }
  };

  var generate = function(apiSpec, done) {
    var implPath = path.resolve(apiSpec.path, '..', apiSpec.implementation.path);

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
          var execPath = path.resolve(apiSpec.path, '..', executable.path);

          executable.path = path.join('executables', execName);

          fs.copy(execPath, path.resolve(implPath, executable.path), callback);
        }, callback);
      },
      function(callback) {
        // Copy invokers
        async.each(_.keys(apiSpec.invokers), function(invokerName, callback) {
          var invoker = apiSpec.invokers[invokerName];
          var invokerPath = path.resolve(apiSpec.path, '..', invoker.path);

          invoker.path = path.join('invokers', invokerName);

          fs.copy(invokerPath, path.resolve(implPath, invoker.path), callback);
        }, callback);
      },
      function(callback) {
        util.enrichSpec({ apiSpec: apiSpec, basePath: implPath }, callback);
      },
      function(callback) {
        apiSpec.implementation.wsdl_name = apiSpec.implementation.wsdl_name || 'soap-api-' + shortId.generate();
        apiSpec.implementation.wsdl_ns = apiSpec.implementation.wsdl_ns || 'http://generated.any2api.org/' + apiSpec.implementation.wsdl_name;
        apiSpec.implementation.wsdl_ns_prefix = apiSpec.implementation.wsdl_ns_prefix || 'SOAP-API';

        apiSpec.implementation.wsdl_doc = '';
        if (apiSpec.implementation.title) apiSpec.implementation.wsdl_doc += apiSpec.implementation.title;
        if (apiSpec.implementation.description) apiSpec.implementation.wsdl_doc += '\n\n' + apiSpec.implementation.description;
        apiSpec.implementation.wsdl_doc = cdataEscape(apiSpec.implementation.wsdl_doc);
        if (_.isEmpty(apiSpec.implementation.wsdl_doc)) delete apiSpec.implementation.wsdl_doc;

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

            def.wsdl_doc = def.wsdl_doc || '';

            if (!_.isEmpty(def.description)) def.wsdl_doc += 'Description: ' + def.description;
            if (!_.isNil(def.default)) {
              if (S(def.type).toLowerCase().contains('json')) {
                def.wsdl_default = def.wsdl_default || JSON.stringify(def.default);
              } else {
                def.wsdl_default = def.wsdl_default || def.default;
              }

              def.wsdl_default = _.escape(def.wsdl_default);
            }

            if (S(def.type).toLowerCase().contains('number')) {
              def.wsdl_type_name = 'decimal';
              def.wsdl_type_ns_prefix = 'xsd';
            } else if (S(def.type).toLowerCase().contains('boolean')) {
              def.wsdl_type_name = 'boolean';
              def.wsdl_type_ns_prefix = 'xsd';
            } else if (S(def.type).toLowerCase().contains('binary')) {
              def.wsdl_type_name = 'base64Binary';
              def.wsdl_type_ns_prefix = 'xsd';
            } else if (S(def.type).toLowerCase().contains('json')) {
              def.wsdl_type_name = 'string';
              def.wsdl_type_ns_prefix = 'xsd';

              def.wsdl_doc += '\n\nActual type: JSON';

              if (!_.isEmpty(def.json_schema)) {
                def.wsdl_doc += '\n\nJSON schema:\n' + JSON.stringify(def.json_schema, null, 2);
              }
            } else if (S(def.type).toLowerCase().contains('xml')) {
              def.wsdl_type_name = itemName + '_' + def.wsdl_name;
              def.wsdl_type_ns_prefix = apiSpec.implementation.wsdl_ns_prefix;

              def.xml_schema = def.xml_schema || '<xsd:any minOccurs="0" maxOccurs="unbounded"/>';
            } else {
              def.wsdl_type_name = 'string';
              def.wsdl_type_ns_prefix = 'xsd';
            }

            def.wsdl_doc = cdataEscape(def.wsdl_doc);

            if (_.isEmpty(def.wsdl_doc)) delete def.wsdl_doc;
            //def.wsdl_doc = _.escape(def.wsdl_doc);
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

            item.wsdl_porttype_name = item.wsdl_name + 'PortType';
            item.wsdl_cb_porttype_name = item.wsdl_name + 'CallbackPortType';
            item.wsdl_soapbinding_name = item.wsdl_name + 'SoapBinding';
            item.wsdl_cb_soapbinding_name = item.wsdl_name + 'CallbackSoapBinding';
            item.wsdl_port_name = item.wsdl_name + 'Port';
            item.wsdl_cb_port_name = item.wsdl_name + 'CallbackPort';
            item.wsdl_service_name = item.wsdl_name + 'Service';
            item.wsdl_cb_service_name = item.wsdl_name + 'CallbackService';
            item.wsdl_url_path = item.wsdl_service_name + '/' + item.wsdl_port_name;

            enrichSchema(item.parameters_schema, item.wsdl_name);
            enrichSchema(item.results_schema, item.wsdl_name);
          });
        });

        var exposedInvokers = {};
        _.each(apiSpec.invokers, function(invoker, name) {
          if (invoker.expose) exposedInvokers[name] = invoker;
        });

        fs.readFile(path.resolve(__dirname, '..', 'tpl', 'spec.wsdl.tpl'), 'utf8', function(err, content) {
          var wsdlSpec = _.template(content)({
            executables: apiSpec.executables,
            invokers: exposedInvokers,
            implementation: apiSpec.implementation,
            instanceTypeDef: util.instanceSchemaXml,
            instanceWritableTypeDef: util.instanceWritableSchemaXml,
            executableTypeDef: util.embeddedExecutableSchemaXml
          });

          // Remove wsdl_doc properties because they are just overhead
          delete apiSpec.implementation.wsdl_doc;

          _.each([
            { collection: apiSpec.executables },
            { collection: apiSpec.invokers }
          ], function(c) {
            _.each(c.collection, function(item, name) {
              _.each(item.parameters_schema, function(def) {
                delete def.wsdl_doc;
              });

              _.each(item.results_schema, function(def) {
                delete def.wsdl_doc;
              });
            });
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



var cdataEscape = function(data) {
  if (!data) return null;
  else return data.trim().replace(/]]>/g, ']]]]><![CDATA[>');
};
