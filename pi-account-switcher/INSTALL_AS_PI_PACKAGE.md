# Install Pi Account Switcher as a Pi Package

This repo can be installed by Pi from GitHub now, and can be installed with `pi install npm:@hieplp/pi-account-switcher` after it is published to npm.

## Install from GitHub

Install globally:

```bash
pi install git:github.com/hieplp/pi-account-switcher
```

Or test for one Pi run without permanently installing:

```bash
pi -e git:github.com/hieplp/pi-account-switcher
```

Install project-locally, writing to `.pi/settings.json`:

```bash
pi install -l git:github.com/hieplp/pi-account-switcher
```

Then inside Pi, add your first account:

```txt
/reload
/accounts:add
```

## Install like `pi install npm:@hieplp/pi-account-switcher`

The package is configured for npm publishing with:

- `keywords: ["pi-package", "pi-extension", ...]`
- `pi.extensions: ["./src/extension.ts"]`
- Pi core packages in `peerDependencies`
- runtime dependency `zod` in `dependencies`
- package files limited to `src`, `README.md`, `USAGE.md`, and this install guide

### Publish to npm

Login to npm:

```bash
npm login
```

Optional: verify what will be published:

```bash
npm pack --dry-run
```

Publish (scoped packages require `--access public`):

```bash
npm publish --access public
```

After publishing, users can install globally with:

```bash
pi install npm:@hieplp/pi-account-switcher
```

Or install project-locally with:

```bash
pi install -l npm:@hieplp/pi-account-switcher
```

To test without permanently installing:

```bash
pi -e npm:@hieplp/pi-account-switcher
```
