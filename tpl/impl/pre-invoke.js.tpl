const _ = require('lodash');
const async = require('async');

module.exports = function(instance, parameters, executable, invoker, callback) {
  callback = _.once(callback);

  const done = callback;

  try {
    <%= code %>
  } catch (err) {
    callback(err, instance, parameters);
  }

  //TODO setTimeout: callback with err due to timeout
  //callback(null, instance, parameters);
};
