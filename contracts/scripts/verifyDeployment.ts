import fs from "fs";
import path from "path";
import { ethers, network } from "hardhat";

async function main() {
  const deploymentPath = path.join(process.cwd(), "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentPath)) throw new Error(`Missing deployment file: ${deploymentPath}`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as { address: string };
  const contract = await ethers.getContractAt("MediChainHealthRecords", deployment.address);
  const adminRole = await contract.DEFAULT_ADMIN_ROLE();
  const [signer] = await ethers.getSigners();
  const isAdmin = await contract.hasRole(adminRole, signer.address);
  console.log(`Contract: ${deployment.address}`);
  console.log(`Signer: ${signer.address}`);
  console.log(`Signer has DEFAULT_ADMIN_ROLE: ${isAdmin}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
