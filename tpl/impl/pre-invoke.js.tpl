var _ = require('lodash');
var async = require('async');

module.exports = function(instance, executable, invoker, callback) {
  callback = _.once(callback);

  <%= code %>

  callback(null, instance);
};
