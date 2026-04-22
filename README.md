# PROZESSOR

A terminal-first process manager for running and maintaining multiple Node services from one place.

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)]() [![Lightweight](https://img.shields.io/badge/dependencies-lightweight-blue.svg)]() [![Plain JS](https://img.shields.io/badge/build-plain%20js-orange.svg)]()

![Prozessor Demo](./assets/demo.gif)
> **Note**: Don't forget to replace this placeholder with a GIF or screenshot of your tool in action! (Place it in the `assets` folder)

## What is this?

Prozessor is a lightweight terminal process manager. Instead of juggling multiple terminal tabs, it lets you manage all your project repositories from a single Live TUI Dashboard.

 It handles cloning, branch tracking, log streaming, and process monitoring automatically.

### Key Features
*   🔄 **Automated Git Ops**: Auto-clones your project repos and periodically checks for branch updates.
*   📊 **Live TUI Dashboard**: Monitor all your services in one terminal window with multiplexed log streaming.
*   🛡️ **Resilient**: Automatic process restarts, crash retries, and cooldown periods keep your services healthy.
*   🪶 **Lightweight**: Plain Node.js (ESM), zero build steps, and no heavy dependencies.

---

## Getting Started

Follow these steps to set up and run it on your machine.

### 1. Requirements
Ensure you have the following installed on your system:
*   **Node.js**: `v18+`
*   **Git**: Required for cloning and managing repositories.

### 2. Clone the Repository
Clone PROZESSOR to your local machine and install its dependencies:
```bash
git clone https://github.com/SiddDevZ/prozessor-cli.git
cd prozessor
npm install
```

### 3. Configure Your Projects
You need to tell it which projects to manage. We provide a safe template to start with. Run the following command to create your local config file:
```bash
cp projects.example.json projects.json
```

Open `projects.json` in your editor and define your repositories. 

### 4. Setup Environment Variables (Optional)
If your managed projects require `.env` files, you can store them securely in the `envs/` directory.
1. Create your env files (e.g., `envs/.env.myproject`).
2. Link them in your `projects.json` by setting the `envSrc` property for that project.

### 5. Run PROZESSOR
Start the process manager to bring up the dashboard and spawn your services:
```bash
npm start
```

---


### `projects.json` Properties

Each project entry in your `projects.json` supports the following:

| Property | Description | Default |
| :--- | :--- | :--- |
| `name` | Display key and local folder name (created under `projects/`) | - |
| `repoUrl` | Git remote URL to clone from | - |
| `branch` | Branch to track and auto-update | - |
| `envSrc` | Env filename inside the `envs/` folder *(Optional)* | - |
| `subdir` | Project subdirectory where the Node service lives | `backend` |
| `entrypoint` | Node entry file to run | `server.js` |
| `enabled` | Whether it should manage this project | `true` |

**Global Application Settings:**
*   `pollInterval`: How often to check for git updates.
*   `logBufferSize`: Number of log lines to keep in memory.
*   `maxCrashRetries`: How many times to restart a crashing process.
*   `autoUpdateCli`: Automatically fetch and update the CLI
*   `crashCooldownMins`: Cooldown duration after exceeding max retries.

## Dashboard Controls

Navigate your services effortlessly using these built-in keyboard shortcuts:

| Key | Action |
| :--- | :--- |
| `m` | Open the management menu |
| `f` | Cycle through project log filters |
| `0` | Clear active log filter |
| `1-9` | Quick-filter to a specific project by index |
| `↑` / `↓` / `PgUp` / `PgDn` | Scroll through the log history |
| `q` / `Ctrl+C` | Quit and gracefully shut down all services |

## Project Structure

```text
prozessor/
├── lib/
│   ├── config.js
│   ├── git-ops.js
│   ├── process-manager.js
│   ├── log-store.js
│   ├── theme.js
│   ├── ui.js
│   └── flair.js
├── envs/
│   └── .env.example
├── projects/                 # Managed repositories are cloned here
├── main.js                   # Application Entrypoint
├── projects.json             # Your local configuration
├── package.json
└── .gitignore
```

## Security Best Practices

For a clean and secure public release, ensure you:
*   **Never** commit real `.env` files to github.
*   **Never** commit your populated `projects.json`.
*   **Never** commit the cloned repositories under the `projects/` directory.

*(These paths are already ignored in `.gitignore` by default).*

## License

*(Add your preferred license before publishing)*
