// Run in CI after `cap sync android`.
// 1) sets versionName / versionCode  2) adds release signing from android/key.properties.
// Safe to run more than once, and independent of the app's package name.
const fs = require('fs');
const file = 'android/app/build.gradle';
let s = fs.readFileSync(file, 'utf8');
const version = process.env.APP_VERSION;
const code = process.env.VERSION_CODE;
if (!version || !code) throw new Error('APP_VERSION and VERSION_CODE must be set');

s = s.replace(/versionCode\s+\d+/, `versionCode ${code}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);

if (!s.includes('keystoreProperties')) {
  const header =
    "def keystoreProperties = new Properties()\n" +
    "def keystorePropertiesFile = rootProject.file('key.properties')\n" +
    "if (keystorePropertiesFile.exists()) {\n" +
    "    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n" +
    "}\n\n";
  const signing =
    "    signingConfigs {\n" +
    "        release {\n" +
    "            keyAlias keystoreProperties['keyAlias']\n" +
    "            keyPassword keystoreProperties['keyPassword']\n" +
    "            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null\n" +
    "            storePassword keystoreProperties['storePassword']\n" +
    "        }\n" +
    "    }\n";
  // use the release signing config in the release build type first, then add the signingConfigs block before buildTypes
  const before = s;
  s = s.replace(/(buildTypes\s*\{\s*release\s*\{\n)/, (m) => m + '            signingConfig signingConfigs.release\n');
  if (s === before) throw new Error('Could not find buildTypes.release in build.gradle');
  s = s.replace(/(\n\s*)buildTypes\s*\{/, (m) => '\n' + signing + m.replace(/^\n/, ''));
  s = header + s;
}
fs.writeFileSync(file, s);
console.log(`patched ${file}: versionName ${version}, versionCode ${code}`);
