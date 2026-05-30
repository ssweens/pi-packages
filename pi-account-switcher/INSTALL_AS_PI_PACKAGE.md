# Install Pi Account Switcher as a Pi Package

This package should be installed from npm as `pi install npm:@ssweens/pi-account-switcher`.

The source lives in the [`ssweens/pi-packages`](https://github.com/ssweens/pi-packages/tree/main/pi-account-switcher) monorepo.

## Install from npm

Install globally:

```bash
pi install npm:@ssweens/pi-account-switcher
```

Or test for one Pi run without permanently installing:

```bash
pi -e npm:@ssweens/pi-account-switcher
```

Install project-locally, writing to `.pi/settings.json`:

```bash
pi install -l npm:@ssweens/pi-account-switcher
```

Then inside Pi, add your first account:

```txt
/reload
/accounts:add
```

## Install like `pi install npm:@ssweens/pi-account-switcher`

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
pi install npm:@ssweens/pi-account-switcher
```

Or install project-locally with:

```bash
pi install -l npm:@ssweens/pi-account-switcher
```

To test without permanently installing:

```bash
pi -e npm:@ssweens/pi-account-switcher
```
