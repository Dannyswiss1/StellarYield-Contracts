# 🌌 StellarWave Suite

> **A collection of high-performance decentralized protocols and applications built on the Stellar Network.**

This repository is a comprehensive monorepo containing a diverse suite of projects developed for the **Stellar Wave 3** program. From Real-World Asset (RWA) yield platforms to parametric insurance and on-chain gaming, this collection showcases the power, speed, and efficiency of **Stellar Soroban** smart contracts.

---

## 🌟 Featured Project: StellarYield

**StellarYield** is the flagship protocol of this suite — a native **Real-World Asset (RWA) yield platform**.

- **RWA Vaults**: Tokenized investment in high-quality assets (Treasury Bills, Corporate Bonds).
- **Compliant Onboarding**: Integrated with **zkMe** for trustless KYC verification.
- **Yield Distribution**: Automated per-epoch yield harvesting and distribution.
- **Lifecycle Management**: Complete on-chain management from funding to maturity.

Explore it in: [`/soroban-contracts`](./soroban-contracts)

---

## 📂 Project Directory

| Category | Project | Description | Link |
| :--- | :--- | :--- | :--- |
| **Finance & RWA** | **StellarYield** | Flagship RWA yield-bearing vault protocol. | [Link](./soroban-contracts) |
| | **StellarInsure** | Parametric insurance with automated oracle payouts. | [Link](./StellarInsure) |
| | **ChainBridge** | Trustless cross-chain atomic swaps (BTC, ETH, SOL). | [Link](./ChainBridge) |
| | **PayD** | Stellar-based cross-border payroll for organizations. | [Link](./PayD) |
| **Marketplaces** | **StellarMarket** | Freelance marketplace with escrow and reputation. | [Link](./stellar-market) |
| | **Afristore** | Marketplace for African art using IPFS + Soroban. | [Link](./marketplace) |
| | **Access Layer** | Creator key marketplace with bonding curve pricing. | [Link](./accesslayer-contracts) |
| **Social & Tips** | **TipTune** | Real-time music tipping for independent artists. | [Link](./tip-tune) |
| | **Stellar-Tipz** | Social media tipping with on-chain credit scores. | [Link](./Stellar-Tipz) |
| | **DEX-CHAT** | AI-powered asset-to-fiat bridge in a chat interface. | [Link](./Stellar-Dex-Chat) |
| **Gaming & Apps** | **Inverse Arena** | RWA-powered "Last Man Standing" elimination game. | [Link](./inversearena-frontend) |
| | **Stellarcade** | Provably fair gaming platform with prize pools. | [Link](./StellarCade) |
| | **Lernza** | Milestone-based "Learn to Earn" education incentive platform. | [Link](./lernza) |
| | **Navin** | Blockchain-powered logistics and shipment tracking. | [Link](./navin-frontend) |
| | **Goal Vault** | Decentralized crowdfunding MVP for the ecosystem. | [Link](./stellar-goal-vault) |
| **Security** | **StellarGuard** | Multi-sig treasury and DAO governance platform. | [Link](./stellarguard) |

---

## 🛠 Tech Stack

The projects in this repository share a modern, robust technical foundation:

- **Smart Contracts**: [Soroban SDK](https://soroban.stellar.org/) (Rust)
- **Frontend**: React 19, Next.js 14/15, TypeScript, Tailwind CSS
- **Wallets**: [Freighter](https://www.freighter.app/), Albedo, xBull
- **Backend API**: Node.js (Express/NestJS), FastAPI (Python), Prisma ORM
- **Database**: PostgreSQL, Redis, SQLite
- **Storage**: IPFS (Pinata, Web3.Storage)

---

## 🚀 Getting Started

### Prerequisites

- **Stellar CLI**: `cargo install --locked stellar-cli`
- **Rust**: `rustup target add wasm32-unknown-unknown`
- **Node.js**: v18 or later
- **Package Managers**: `npm`, `pnpm`, or `yarn` (depending on the subproject)

### Exploration

Each subproject is self-contained. To explore a specific project:

1.  Navigate to its directory.
2.  Follow the specific `README.md` instructions for that project.
3.  Commonly: `npm install && npm run dev`.

### Common Build Command (Soroban)

To build all contracts in projects that use a root Cargo workspace:

```bash
stellar contract build
```

---

## 🤝 Contributing

We welcome contributions from the Stellar community!

1.  **Browse Issues**: Each subproject has its own set of issues and contribution guidelines.
2.  **Standards**: Please adhere to the `CONTRIBUTING.md` found in individual project folders.
3.  **Security**: Report security vulnerabilities via the methods described in each project's `SECURITY.md`.

---

## 📄 License

Most projects in this suite are licensed under the **MIT License** or **Apache-2.0**. See the `LICENSE` file within each subproject for specific details.

---

*Built with ❤️ for the Stellar Ecosystem*
