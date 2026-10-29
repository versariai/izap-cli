# @izapai/cli

`izap` is the command-line tool for the [iZap](https://izap.ai) REST API. Check your
credentials, list chats, WhatsApp templates and bulk transmissions, and send WhatsApp
messages from a terminal or a script. It is built on
[`@izapai/sdk`](https://www.npmjs.com/package/@izapai/sdk). Full API reference:
[devs.izap.ai](https://devs.izap.ai).

## Install

```bash
npm install -g @izapai/cli
izap --help
```

Or run it once with `npx @izapai/cli whoami`. It needs Node.js 20 or later.

## Log in

Create a personal access token in the iZap dashboard under **User Settings → API
Keys**. API keys are available on plans that include the REST API. Tokens start with
`izap_pat_` and act as you.

```bash
izap login                           # prompts for the token (input is hidden)
izap login < token.txt               # reads it from stdin
IZAP_TOKEN=izap_pat_... izap login   # saves the token in IZAP_TOKEN
izap login --token izap_pat_...      # works, but leaves the token in your shell history
izap whoami                          # checks it against the API
```

`izap login` saves the token without calling the API; `izap whoami` is the check.

### Log in with the browser

```bash
izap login --browser
```

This opens iZap's login page in your browser. It uses OAuth 2.0 authorization code with
PKCE:

- The CLI registers itself as a public client, with no client secret.
- It listens on `127.0.0.1` at a random port for the redirect.
- The listener closes after the first callback request, or after 5 minutes.

The session renews itself when its access token expires. `izap logout` revokes it on
the server.

### Where credentials live

Credentials are saved in `$XDG_CONFIG_HOME/izap/config.json`, or
`~/.config/izap/config.json` when `XDG_CONFIG_HOME` is not set. The directory is created
with mode `0700` and the file is written with mode `0600`. The CLI warns if the file
becomes readable by others.

The token to use is picked in this order:

1. The `IZAP_TOKEN` environment variable. It always wins.
2. The profile's saved token.
3. The profile's browser login.

`izap logout` removes the saved credential. It cannot unset `IZAP_TOKEN`.

### Profiles

Each profile keeps its own credential, API origin and default business:

```bash
izap login --profile staging --staging            # https://api-staging.izap.ai
izap login --business 8f0b9e2a-...                # saves a default business
izap chats list --profile staging
```

The profile is `default` unless you pass `--profile` or set `IZAP_PROFILE`.

```json
{
  "profiles": {
    "default": {
      "baseUrl": "https://api.izap.ai",
      "businessId": "8f0b9e2a-0000-4000-8000-000000000001",
      "token": "izap_pat_..."
    }
  }
}
```

## Commands

| Command                                     | What it does                                                      |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `izap login [--token <t> \| --browser]`     | Saves a credential for a profile                                  |
| `izap logout`                               | Removes the saved credential (and revokes a browser login)        |
| `izap whoami`                               | Shows the user, business and token the credential resolves to     |
| `izap chats list`                           | Lists conversations (`--kind`, `--page`, `--page-size`, `--since`) |
| `izap messages send --chat <id> --text <t>` | Sends a WhatsApp message into a chat (asks you to confirm)        |
| `izap templates list`                       | Lists WhatsApp message templates (`--status`)                     |
| `izap transmissions list`                   | Lists bulk transmissions (`--status`, `--limit`)                  |
| `izap transmissions show <id>`              | Shows one transmission's status and counts                        |
| `izap init [args...]`                       | Runs the setup wizard (`npx -y @izapai/wizard`)                   |

`izap <command> --help` shows a command's flags.

### Global flags

| Flag               | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `--json`           | Print JSON on stdout; errors go to stderr as JSON                   |
| `--profile <name>` | Config profile (default `default`, or `IZAP_PROFILE`)               |
| `--business <id>`  | Business to act on (default `IZAP_BUSINESS_ID`, then the profile's) |
| `--staging`        | Use the staging API, `https://api-staging.izap.ai`                  |
| `--base-url <url>` | Use another API origin (`http://` only for localhost)               |

### Choosing a business

Chats, templates and transmissions belong to one business. The CLI takes it from
`--business`, then `IZAP_BUSINESS_ID`, then the profile's saved default. When none of
those is set, the command stops with a usage error before it calls the API.

### Sending messages

Sends are real and cannot be undone. `izap messages send` shows the message and asks
before sending. Pass `--yes` to skip the question. A script or any other shell whose
stdin is not a terminal must pass `--yes`; without it the command refuses to send and
exits with code 2.

The message goes out as a human agent, so the AI assistant does not reply to it. Outside
WhatsApp's 24-hour customer-service window, only an approved template can reach the
customer.

`izap chats list` shows WhatsApp customer chats by default (`--kind real`). Use
`--kind trainer` for AI Trainer sandbox chats, or `--kind all`.

### Setup wizard

`izap init` runs [`@izapai/wizard`](https://www.npmjs.com/package/@izapai/wizard)
through `npx` and passes every argument after `init` to it unchanged. For example,
`izap init plan` or `izap init mcp add --client cursor`.

## JSON mode

With `--json`, a command prints its result as JSON on stdout. This is the API response
as-is, or a small object for `login`, `logout` and `whoami`. Errors are printed to
stderr as JSON:

```bash
izap chats list --json | jq -r '.chats[] | [.id, .consumer.nickname] | @tsv'
izap whoami --json 2>/dev/null || echo "not logged in"
```

```json
{
  "error": {
    "type": "auth",
    "message": "iZap API error 401: Not authenticated",
    "status": 401,
    "code": null,
    "hint": "..."
  }
}
```

The CLI never prints a token. Anything shaped like an iZap token, a bearer credential
or a JWT is replaced with `[REDACTED]` in output and in errors.

## Exit codes

| Code | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | Success                                                                            |
| 1    | API or network error (the API returned an error, or could not be reached)          |
| 2    | Usage error (bad flag or argument, no business selected, send without `--yes`)     |
| 3    | Authentication error (no credential, the API returned 401, the browser login failed) |
| 4    | Cancelled (you answered no to a confirmation)                                      |

## Environment variables

| Variable           | Meaning                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `IZAP_TOKEN`       | Token to use. It takes precedence over any saved credential      |
| `IZAP_PROFILE`     | Default for `--profile`                                          |
| `IZAP_BUSINESS_ID` | Default for `--business`                                         |
| `IZAP_BASE_URL`    | API origin, when neither `--staging` nor `--base-url` is given   |
| `XDG_CONFIG_HOME`  | Parent directory of `izap/config.json` (default `~/.config`)     |

## Development

```bash
npm ci
npm test               # type-check and run the tests (no network)
npm run build          # emit dist/
node dist/bin.js --help
```

## License

[MIT](LICENSE)
