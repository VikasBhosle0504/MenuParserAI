const controllers = require('./controllers');
const { processHybridMenuUpload } = require('./services/hybridMenuService');

module.exports = {
  ...controllers,
  processHybridMenuUpload
}; 