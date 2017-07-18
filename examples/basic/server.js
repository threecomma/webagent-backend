const waBackend = require('../../dist/main')

waBackend(
  {
    mongoURL: 'mongodb://yourdbpath',
    dataRequirements: {
      Test: {
        title: { type: String },
        content: { type: String }
      }
    }
  }
)
