const path = require('path');

module.exports = {
  entry: './demo/demo.js',
  mode: 'development',
  output: {
    filename: 'demo.js',
    path: path.resolve(__dirname, 'dist')
  },
  module: {
      rules: [
          {
              test: /ogv-.*\.(wasm|js)$/,
              type: "javascript/auto", // fix wasm
              use: [
                  'file-loader'
              ]
          }
      ]
  }
};
