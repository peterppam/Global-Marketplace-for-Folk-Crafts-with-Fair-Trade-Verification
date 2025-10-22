import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV, listCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_ARTISAN = 101;
const ERR_INVALID_VERIFIER = 102;
const ERR_INVALID_CERT = 103;
const ERR_CERT_EXISTS = 104;
const ERR_CERT_NOT_FOUND = 105;
const ERR_INVALID_TIMESTAMP = 106;
const ERR_INVALID_STAKE = 107;
const ERR_VERIFIER_NOT_STAKED = 108;
const ERR_INVALID_CRITERIA = 109;
const ERR_INVALID_METADATA = 110;
const ERR_STAKE_LOCKED = 111;
const ERR_INVALID_REWARD = 112;
const ERR_MAX_VERIFIERS = 113;
const ERR_INVALID_STATUS = 114;

interface Artisan {
  verified: boolean;
  lastVerified: number;
  certId: number | null;
}

interface Verifier {
  stake: number;
  active: boolean;
  lastAction: number;
}

interface Certification {
  artisan: string;
  verifier: string;
  criteriaMet: string[];
  metadata: string;
  timestamp: number;
  status: boolean;
}

interface VerificationRequest {
  artisan: string;
  verifier: string | null;
  timestamp: number;
  status: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class FairTradeVerifierMock {
  state: {
    nextCertId: number;
    maxVerifiers: number;
    minStake: number;
    stakeLockPeriod: number;
    rewardPool: number;
    admin: string;
    artisans: Map<string, Artisan>;
    verifiers: Map<string, Verifier>;
    certifications: Map<number, Certification>;
    verificationRequests: Map<number, VerificationRequest>;
  } = {
    nextCertId: 0,
    maxVerifiers: 100,
    minStake: 1000,
    stakeLockPeriod: 1440,
    rewardPool: 0,
    admin: "ST1ADMIN",
    artisans: new Map(),
    verifiers: new Map(),
    certifications: new Map(),
    verificationRequests: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  reset() {
    this.state = {
      nextCertId: 0,
      maxVerifiers: 100,
      minStake: 1000,
      stakeLockPeriod: 1440,
      rewardPool: 0,
      admin: "ST1ADMIN",
      artisans: new Map(),
      verifiers: new Map(),
      certifications: new Map(),
      verificationRequests: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  setMinStake(newStake: number): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (newStake < this.state.minStake) return { ok: false, value: ERR_INVALID_STAKE };
    this.state.minStake = newStake;
    return { ok: true, value: true };
  }

  registerVerifier(stakeAmount: number): Result<boolean> {
    if (this.state.verifiers.has(this.caller)) return { ok: false, value: ERR_INVALID_VERIFIER };
    if (stakeAmount < this.state.minStake) return { ok: false, value: ERR_INVALID_STAKE };
    if (this.caller === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.verifiers.size >= this.state.maxVerifiers) return { ok: false, value: ERR_MAX_VERIFIERS };
    this.stxTransfers.push({ amount: stakeAmount, from: this.caller, to: "contract" });
    this.state.verifiers.set(this.caller, { stake: stakeAmount, active: true, lastAction: this.blockHeight });
    return { ok: true, value: true };
  }

  withdrawStake(): Result<boolean> {
    const verifier = this.state.verifiers.get(this.caller);
    if (!verifier) return { ok: false, value: ERR_INVALID_VERIFIER };
    if (!verifier.active) return { ok: false, value: ERR_INVALID_VERIFIER };
    if (this.blockHeight < verifier.lastAction + this.state.stakeLockPeriod) return { ok: false, value: ERR_STAKE_LOCKED };
    this.state.verifiers.set(this.caller, { stake: 0, active: false, lastAction: this.blockHeight });
    this.stxTransfers.push({ amount: verifier.stake, from: "contract", to: this.caller });
    return { ok: true, value: true };
  }

  requestVerification(): Result<number> {
    const artisanData = this.state.artisans.get(this.caller);
    if (artisanData?.certId !== null) return { ok: false, value: ERR_CERT_EXISTS };
    if (this.caller === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_NOT_AUTHORIZED };
    const requestId = this.state.nextCertId;
    this.state.artisans.set(this.caller, { verified: false, lastVerified: 0, certId: null });
    this.state.verificationRequests.set(requestId, { artisan: this.caller, verifier: null, timestamp: this.blockHeight, status: true });
    this.state.nextCertId++;
    return { ok: true, value: requestId };
  }

  verifyArtisan(requestId: number, criteria: string[], metadata: string): Result<number> {
    const request = this.state.verificationRequests.get(requestId);
    const verifier = this.state.verifiers.get(this.caller);
    if (!request) return { ok: false, value: ERR_CERT_NOT_FOUND };
    if (!verifier || !verifier.active) return { ok: false, value: ERR_VERIFIER_NOT_STAKED };
    if (!request.status) return { ok: false, value: ERR_INVALID_STATUS };
    if (criteria.length === 0) return { ok: false, value: ERR_INVALID_CRITERIA };
    if (metadata.length > 256) return { ok: false, value: ERR_INVALID_METADATA };
    if (this.blockHeight < request.timestamp) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    const certId = this.state.nextCertId;
    this.state.certifications.set(certId, {
      artisan: request.artisan,
      verifier: this.caller,
      criteriaMet: criteria,
      metadata,
      timestamp: this.blockHeight,
      status: true
    });
    this.state.artisans.set(request.artisan, { verified: true, lastVerified: this.blockHeight, certId });
    this.state.verificationRequests.set(requestId, { ...request, verifier: this.caller, status: false });
    this.state.nextCertId++;
    this.state.rewardPool -= Math.floor(this.state.rewardPool / 10);
    this.stxTransfers.push({ amount: Math.floor(this.state.rewardPool / 10), from: "contract", to: this.caller });
    return { ok: true, value: certId };
  }

  getArtisan(artisan: string): Artisan | null {
    return this.state.artisans.get(artisan) || null;
  }

  getCertification(certId: number): Certification | null {
    return this.state.certifications.get(certId) || null;
  }

  getCertCount(): Result<number> {
    return { ok: true, value: this.state.nextCertId };
  }
}

describe("FairTradeVerifier", () => {
  let contract: FairTradeVerifierMock;

  beforeEach(() => {
    contract = new FairTradeVerifierMock();
    contract.reset();
  });

  it("registers verifier successfully", () => {
    const result = contract.registerVerifier(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const verifier = contract.state.verifiers.get("ST1TEST");
    expect(verifier).toEqual({ stake: 1000, active: true, lastAction: 0 });
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "contract" }]);
  });

  it("rejects verifier registration with low stake", () => {
    const result = contract.registerVerifier(500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STAKE);
  });

  it("rejects duplicate verifier registration", () => {
    contract.registerVerifier(1000);
    const result = contract.registerVerifier(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VERIFIER);
  });

  it("withdraws stake successfully", () => {
    contract.registerVerifier(1000);
    contract.blockHeight = 1440;
    const result = contract.withdrawStake();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const verifier = contract.state.verifiers.get("ST1TEST");
    expect(verifier).toEqual({ stake: 0, active: false, lastAction: 1440 });
    expect(contract.stxTransfers).toContainEqual({ amount: 1000, from: "contract", to: "ST1TEST" });
  });

  it("rejects stake withdrawal before lock period", () => {
    contract.registerVerifier(1000);
    contract.blockHeight = 100;
    const result = contract.withdrawStake();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_STAKE_LOCKED);
  });

  it("rejects verification request with existing cert", () => {
    contract.requestVerification();
    contract.caller = "ST2VERIFIER";
    contract.registerVerifier(1000);
    contract.verifyArtisan(0, ["Fair wages"], "Metadata");
    contract.caller = "ST1TEST";
    const result = contract.requestVerification();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CERT_EXISTS);
  });

  it("sets min stake successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setMinStake(2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.minStake).toBe(2000);
  });

  it("rejects min stake change by non-admin", () => {
    contract.caller = "ST2FAKE";
    const result = contract.setMinStake(2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });
});