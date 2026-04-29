module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // Reanimated 4 uses the worklets plugin (react-native-reanimated/plugin
    // is deprecated in v4). Worklets plugin must be listed last.
    plugins: ['react-native-worklets/plugin'],
  };
};
