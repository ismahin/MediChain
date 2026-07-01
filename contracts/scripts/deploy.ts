import fs from "fs";
import path from "path";
import { ethers, network } from "hardhat";

const explorers: Record<string, string> = {
  sepolia: "https://sepolia.etherscan.io",
  skaleBaseSepolia: "https://base-sepolia-testnet-explorer.skalenodes.com"
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("MediChainHealthRecords");
  const contract = await factory.deploy(deployer.address);
  await contract.waitForDeployment();
  const deploymentTx = contract.deploymentTransaction();
  const address = await contract.getAddress();

  const output = {
    contractName: "MediChainHealthRecords",
    address,
    deployer: deployer.address,
    network: network.name,
    chainId: network.config.chainId,
    transactionHash: deploymentTx?.hash,
    explorer: explorers[network.name] && deploymentTx?.hash ? `${explorers[network.name]}/tx/${deploymentTx.hash}` : null,
    deployedAt: new Date().toISOString()
  };

  const deploymentsDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(deploymentsDir, `${network.name}.json`), `${JSON.stringify(output, null, 2)}\n`);

  console.log("MediChainHealthRecords deployed");
  console.table(output);
  console.log("Next: copy the address into server/.env CONTRACT_ADDRESS and client/.env VITE_CONTRACT_ADDRESS after reviewing the deployment.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
