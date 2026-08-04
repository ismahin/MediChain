import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("MediChainHealthRecords", function () {
  async function deployFixture() {
    const [admin, provider, outsider, patientWallet] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MediChainHealthRecords");
    const contract = await factory.deploy(admin.address);
    await contract.waitForDeployment();
    const patientIdHash = ethers.keccak256(ethers.toUtf8Bytes("MCH-2026-000001"));
    const recordHash = ethers.keccak256(ethers.toUtf8Bytes("record"));
    const metadataHash = ethers.keccak256(ethers.toUtf8Bytes("metadata"));
    const permissionHash = ethers.keccak256(ethers.toUtf8Bytes("permission"));
    return { contract, admin, provider, outsider, patientWallet, patientIdHash, recordHash, metadataHash, permissionHash };
  }

  it("assigns admin roles on deployment", async function () {
    const { contract, admin } = await deployFixture();
    expect(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await contract.hasRole(await contract.SYSTEM_ADMIN_ROLE(), admin.address)).to.equal(true);
  });

  it("adds and removes providers", async function () {
    const { contract, provider } = await deployFixture();
    await expect(contract.addProvider(provider.address)).to.emit(contract, "ProviderAdded").withArgs(provider.address);
    expect(await contract.hasRole(await contract.PROVIDER_ROLE(), provider.address)).to.equal(true);
    await expect(contract.removeProvider(provider.address)).to.emit(contract, "ProviderRemoved").withArgs(provider.address);
    expect(await contract.hasRole(await contract.PROVIDER_ROLE(), provider.address)).to.equal(false);
  });

  it("restricts provider management to system admins", async function () {
    const { contract, provider, outsider } = await deployFixture();
    await expect(contract.connect(outsider).addProvider(provider.address)).to.be.reverted;
  });

  it("registers and verifies a record proof", async function () {
    const { contract, provider, patientIdHash, recordHash, metadataHash } = await deployFixture();
    await contract.addProvider(provider.address);
    await expect(contract.connect(provider).registerRecord(patientIdHash, recordHash, metadataHash, 3))
      .to.emit(contract, "RecordRegistered")
      .withArgs(patientIdHash, recordHash, metadataHash, 3, provider.address, anyValue);

    const result = await contract.verifyRecord(recordHash);
    expect(result.exists).to.equal(true);
    expect(result.patientIdHash).to.equal(patientIdHash);
    expect(result.creator).to.equal(provider.address);
    expect(result.recordType).to.equal(3);
    expect(result.active).to.equal(true);
  });

  it("rejects duplicate record hashes", async function () {
    const { contract, provider, patientIdHash, recordHash, metadataHash } = await deployFixture();
    await contract.addProvider(provider.address);
    await contract.connect(provider).registerRecord(patientIdHash, recordHash, metadataHash, 1);
    await expect(contract.connect(provider).registerRecord(patientIdHash, recordHash, metadataHash, 1)).to.be.revertedWithCustomError(contract, "RecordAlreadyExists");
  });

  it("blocks unauthorized record registration", async function () {
    const { contract, outsider, patientIdHash, recordHash, metadataHash } = await deployFixture();
    await expect(contract.connect(outsider).registerRecord(patientIdHash, recordHash, metadataHash, 1)).to.be.reverted;
  });

  it("grants and revokes access proofs", async function () {
    const { contract, patientWallet, patientIdHash, permissionHash } = await deployFixture();
    const expiresAt = (await time.latest()) + 3600;
    await expect(contract.grantAccess(patientIdHash, patientWallet.address, permissionHash, expiresAt))
      .to.emit(contract, "AccessGranted")
      .withArgs(patientIdHash, patientWallet.address, permissionHash, expiresAt);
    expect(await contract.isAccessActive(patientIdHash, patientWallet.address, permissionHash)).to.equal(true);
    await expect(contract.revokeAccess(patientIdHash, patientWallet.address, permissionHash))
      .to.emit(contract, "AccessRevoked")
      .withArgs(patientIdHash, patientWallet.address, permissionHash);
    expect(await contract.isAccessActive(patientIdHash, patientWallet.address, permissionHash)).to.equal(false);
  });

  it("rejects unknown record types", async function () {
    const { contract, provider, patientIdHash, recordHash, metadataHash } = await deployFixture();
    await contract.addProvider(provider.address);
    await expect(contract.connect(provider).registerRecord(patientIdHash, recordHash, metadataHash, 0))
      .to.be.revertedWithCustomError(contract, "InvalidRecordType");
    await expect(contract.connect(provider).registerRecord(patientIdHash, recordHash, metadataHash, 8))
      .to.be.revertedWithCustomError(contract, "InvalidRecordType");
  });

  it("rejects expired grants and revoking unknown grants", async function () {
    const { contract, patientWallet, patientIdHash, permissionHash } = await deployFixture();
    await expect(contract.grantAccess(patientIdHash, patientWallet.address, permissionHash, await time.latest()))
      .to.be.revertedWithCustomError(contract, "InvalidExpiry");
    await expect(contract.revokeAccess(patientIdHash, patientWallet.address, permissionHash))
      .to.be.revertedWithCustomError(contract, "AccessGrantNotFound");
  });

  it("records emergency access events from providers", async function () {
    const { contract, provider, patientIdHash } = await deployFixture();
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("emergency"));
    await contract.addProvider(provider.address);
    await expect(contract.connect(provider).recordEmergencyAccess(patientIdHash, provider.address, reasonHash))
      .to.emit(contract, "EmergencyAccessRecorded")
      .withArgs(patientIdHash, provider.address, reasonHash, anyValue);
  });
});
