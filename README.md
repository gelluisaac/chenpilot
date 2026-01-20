# Chen Pilot - AI Agent for Cross-Chain DeFi Operations

Chen Pilot is an intelligent AI agent that enables seamless interaction with blockchain networks and DeFi protocols through natural language commands. This agent provides a unified interface for managing Bitcoin wallets, Stellar operations, cross-chain swaps, and DeFi lending/borrowing activities.

---

## Prerequisites

- Node.js 18+  
- PostgreSQL database  
- Environment variables configured (see Configuration section)  

---

## 🛠️ Installation

### Clone the repository
```bash
git clone <repository-url>
cd chenpilot-experimental
````

### Install dependencies

```bash
npm install
```

### Set up environment variables

```bash
cp .env.example .env
# Edit .env with your configuration
```

### Set up the database

```bash
npm run migration:run
```

### Start the development server

```bash
npm run dev
```

---

## Workflow System

The agent uses an intelligent workflow system that:

* **Parses Intent:** Understands natural language commands
* **Plans Workflow:** Creates step-by-step execution plans
* **Executes Tools:** Runs appropriate tools in sequence
* **Manages State:** Tracks operation status and results
* **Provides Feedback:** Returns structured responses

---

## Contributing

* Fork the repository
* Create a feature branch
* Make your changes
* Add tests if applicable
* Submit a pull request

---

## License

This project is licensed under the ISC License.

---

## Support

For support and questions:

* Create an issue in the repository
* Check the API health endpoints
* Review the logs for error details

---

Chen Pilot - Your intelligent gateway to cross-chain DeFi operations

