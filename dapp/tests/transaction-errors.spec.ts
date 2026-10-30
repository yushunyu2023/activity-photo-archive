import { expect, test } from "@playwright/test";
import {
  encodeErrorResult,
  type Hex,
  type PublicClient,
} from "viem";
import { ACTIVITY_PHOTO_REGISTRY_ABI } from "../src/lib/contract";
import {
  ChainTransactionError,
  describeTransactionError,
  waitForSuccessfulTransaction,
} from "../src/lib/transaction-errors";

test("reverted receipt is decoded into a user-facing chain failure", async () => {
  const transactionHash: Hex = `0x${"1".repeat(64)}`;
  const assetId: Hex = `0x${"2".repeat(64)}`;
  const revertData = encodeErrorResult({
    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    errorName: "AssetAlreadyExists",
    args: [assetId],
  });
  const publicClient = {
    waitForTransactionReceipt: async () => ({
      status: "reverted",
      blockNumber: 10n,
    }),
    getTransaction: async () => ({
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
      input: "0x12345678",
      value: 0n,
    }),
    call: async () => {
      throw Object.assign(new Error("execution reverted"), {
        data: revertData,
      });
    },
  } as unknown as PublicClient;

  let failure: unknown;
  try {
    await waitForSuccessfulTransaction({
      publicClient,
      transactionHash,
      abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(ChainTransactionError);
  expect((failure as ChainTransactionError).title).toBe("照片已经发布");
  expect((failure as ChainTransactionError).message).toContain(
    "同一张照片不能重复登记",
  );
});

test("new membership and encryption reverts have actionable messages", () => {
  const cases = [
    {
      errorName: "MemberLimitReached",
      args: [1n, 20n],
      title: "成员数量已满",
    },
    {
      errorName: "MemberAlreadyRemoved",
      args: [
        1n,
        "0x0000000000000000000000000000000000000001",
      ],
      title: "该地址已被永久移除",
    },
    {
      errorName: "OnlyViewerCanBePromoted",
      args: [
        1n,
        "0x0000000000000000000000000000000000000002",
      ],
      title: "无法升级该成员",
    },
    {
      errorName: "AccountEncryptionAlreadyRegistered",
      args: ["0x0000000000000000000000000000000000000003"],
      title: "安全密码已经登记",
    },
  ] as const;

  for (const item of cases) {
    const data = encodeErrorResult({
      abi: ACTIVITY_PHOTO_REGISTRY_ABI,
      errorName: item.errorName,
      args: item.args,
    });
    const error = Object.assign(new Error("execution reverted"), { data });
    expect(
      describeTransactionError(error, ACTIVITY_PHOTO_REGISTRY_ABI).title,
    ).toBe(item.title);
  }
});
