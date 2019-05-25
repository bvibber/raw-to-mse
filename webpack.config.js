const path = require('path');

module.exports = {
  entry: './demo/demo.js',
  //mode: 'development', // warning: macroblock copy ends up slow in dev mode on pre-Chromium Edge
  mode: 'production',
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
          },

          {
            test: /\.m?js$/,
            exclude: /(node_modules|bower_components)/,
            use: {
              loader: 'babel-loader',
              options: {
                presets: ['@babel/preset-env']
              }
            }
          }
      ]
  }
};
