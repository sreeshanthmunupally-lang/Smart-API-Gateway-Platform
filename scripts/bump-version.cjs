/**
 * Manual release/version bump helper.
 * Not run automatically on regular commits; only run manually during releases,
 * packaging, or when an explicit version increment is required.
 * Synchronizes the version across package.json / Cargo.toml / tauri.conf.json
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

try {
  // 1. Read package.json
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // 2. Parse and increment the patch version
  const parts = pkg.version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    console.error(`❌ Unable to parse version: ${pkg.version}`);
    process.exit(1);
  }
  const [maj, min, patch] = parts;
  const newVersion = `${maj}.${min}.${patch + 1}`;

  // 3. Update package.json
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // 4. Update src-tauri/Cargo.toml
  const cargoPath = path.join(ROOT, 'src-tauri', 'Cargo.toml');
  let cargo = fs.readFileSync(cargoPath, 'utf8');
  cargo = cargo.replace(/^version = ".*"/m, `version = "${newVersion}"`);
  fs.writeFileSync(cargoPath, cargo, 'utf8');

  // 5. Update src-tauri/tauri.conf.json
  const tauriPath = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
  const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
  tauri.version = newVersion;
  fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n', 'utf8');

  // 6. Stage the three files for this commit
  execSync('git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json', {
    cwd: ROOT,
    stdio: 'ignore',
  });

  console.log(`🔖 Version auto-bumped: ${oldVersion} → ${newVersion}`);
} catch (err) {
  console.error('❌ Version bump failed:', err.message);
  // Do not block the commit — print a warning only
  process.exit(0);
}
