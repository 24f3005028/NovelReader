const {getDefaultConfig}=require('expo/metro-config');
const path=require('node:path');
const config=getDefaultConfig(__dirname);
// Explicitly watch the hoisted workspace dependencies on Windows/OneDrive too.
const workspaceRoot=path.resolve(__dirname,'../..');
config.watchFolders=[...new Set([...(config.watchFolders||[]),workspaceRoot])];
config.resolver.nodeModulesPaths=[path.join(__dirname,'node_modules'),path.join(workspaceRoot,'node_modules')];
module.exports=config;
