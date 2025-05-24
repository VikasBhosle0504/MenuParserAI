const controllers = require('./controllers');
const { processHybridMenuUpload } = require('./services/hybridMenuService');
const { processMenuWithLangchain, processUploadedFileWithLangchain } = require('./services/langchainMenuService');
const { processMenuWithLangchainVision, processUploadedFileWithLangchainVision } = require('./services/langchainMenuServicewithvision');
module.exports = {
  ...controllers,
  processHybridMenuUpload,
  processMenuWithLangchain,
  processUploadedFileWithLangchain,
  processMenuWithLangchainVision,
  processUploadedFileWithLangchainVision,
}; 