import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Abi,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

type DecodedContractError = {
  errorName: string;
  args?: readonly unknown[];
};

export type TransactionFailure = {
  title: string;
  description: string;
};

export class ChainTransactionError extends Error {
  readonly title: string;
  readonly transactionHash?: Hex;

  constructor(failure: TransactionFailure, transactionHash?: Hex) {
    super(failure.description);
    this.name = "ChainTransactionError";
    this.title = failure.title;
    this.transactionHash = transactionHash;
  }
}

function walkError(
  error: unknown,
  visitor: (candidate: Record<string, unknown>) => boolean,
) {
  let current = error;
  const visited = new Set<unknown>();

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as Record<string, unknown>;
    if (visitor(candidate)) return true;
    current = candidate.cause;
  }

  return false;
}

function findRawRevertData(error: unknown): Hex | undefined {
  let revertData: Hex | undefined;

  walkError(error, (candidate) => {
    const raw = candidate.raw;
    if (typeof raw === "string" && /^0x[0-9a-fA-F]{8,}$/.test(raw)) {
      revertData = raw as Hex;
      return true;
    }

    const data = candidate.data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(data)) {
      revertData = data as Hex;
      return true;
    }

    if (
      data &&
      typeof data === "object" &&
      "data" in data &&
      typeof data.data === "string" &&
      /^0x[0-9a-fA-F]{8,}$/.test(data.data)
    ) {
      revertData = data.data as Hex;
      return true;
    }

    return false;
  });

  return revertData;
}

export function decodeContractError(
  error: unknown,
  abi: Abi,
): DecodedContractError | undefined {
  let decoded: DecodedContractError | undefined;

  walkError(error, (candidate) => {
    if (!(candidate instanceof ContractFunctionRevertedError) || !candidate.data) {
      return false;
    }

    decoded = {
      errorName: candidate.data.errorName,
      args: candidate.data.args,
    };
    return true;
  });

  if (decoded) return decoded;

  const raw = findRawRevertData(error);
  if (!raw) return undefined;

  try {
    const result = decodeErrorResult({ abi, data: raw });
    return {
      errorName: result.errorName,
      args: result.args,
    };
  } catch {
    return undefined;
  }
}

function formatArg(value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  return String(value);
}

function describeContractError(error: DecodedContractError): TransactionFailure {
  const args = error.args ?? [];

  switch (error.errorName) {
    case "AssetAlreadyExists":
      return {
        title: "照片已经发布",
        description:
          "这张原图已在该活动中发布。同一张照片不能重复登记，无需再次上传。",
      };
    case "InvalidKeyEpoch":
      return {
        title: "活动密钥已轮换",
        description: `链上当前密钥代际为 ${formatArg(args[0])}，本次使用 ${formatArg(args[1])}。请重新发布剩余照片。`,
      };
    case "NotActivityOperator":
      return {
        title: "上传权限已失效",
        description: "当前钱包已不再拥有该活动的上传权限。",
      };
    case "ActivityNotFound":
      return {
        title: "活动不存在",
        description: `链上未找到活动 #${formatArg(args[0])}。`,
      };
    case "ActivityAlreadyOwned":
      return {
        title: "已有活动",
        description: `当前钱包已经拥有活动 #${formatArg(args[1])}，每个地址只能创建一个活动。`,
      };
    case "InvalidActivityName":
      return {
        title: "活动名称无效",
        description: "活动名称需要为 1 至 20 个字符，不能包含控制字符或首尾空格。",
      };
    case "OwnerCannotBeMember":
      return {
        title: "所有者无需添加",
        description: "活动所有者已经拥有完整上传和查看权限，不能重复添加为成员。",
      };
    case "AlreadyAssigned":
      return {
        title: "成员已存在",
        description: "该地址已经是活动的上传者或查看者，无需重复添加。",
      };
    case "NotAssigned":
      return {
        title: "成员角色已变化",
        description: "该地址当前不具有要移除的角色，请刷新成员列表后重试。",
      };
    case "MemberLimitReached":
      return {
        title: "成员数量已满",
        description: `每个活动最多 ${formatArg(args[1])} 人，所有者计入其中。请先移除现有成员。`,
      };
    case "MemberAlreadyRemoved":
      return {
        title: "该地址已被永久移除",
        description: "已移除的地址不能重新加入当前活动。",
      };
    case "OnlyViewerCanBePromoted":
      return {
        title: "无法升级该成员",
        description: "只有当前查看者可以单向升级为上传者。",
      };
    case "InvalidAddress":
      return {
        title: "钱包地址无效",
        description: "请输入有效的非零 EVM 地址。",
      };
    case "InvalidPublicKey":
      return {
        title: "公钥无效",
        description: "安全密码登记公钥不能为零值。",
      };
    case "InvalidKdfSalt":
      return {
        title: "密钥派生参数无效",
        description: "安全密码登记参数不能为零值，请重新设置安全密码。",
      };
    case "InvalidKdfVersion":
      return {
        title: "密钥派生版本不受支持",
        description: `当前 DApp 不支持密钥派生版本 ${formatArg(args[0])}，请升级后重试。`,
      };
    case "InvalidEncryptionSchemaVersion":
      return {
        title: "加密方案版本不受支持",
        description: `合约不接受加密方案版本 ${formatArg(args[0])}，请升级后重试。`,
      };
    case "AccountEncryptionAlreadyRegistered":
      return {
        title: "安全密码已经登记",
        description: "当前钱包已绑定安全密码身份，不能覆盖或重新生成。",
      };
    case "InvalidCapturedAt":
      return {
        title: "拍摄时间无效",
        description: "拍摄时间必须早于当前时间，且不能超过当前时间 24 小时。",
      };
    case "InvalidStorageReference":
      return {
        title: "存储引用无效",
        description: "照片或元数据存储引用为空、重复或格式不正确。",
      };
    case "InvalidContentHash":
      return {
        title: "照片哈希无效",
        description: "照片内容哈希不能为零值。",
      };
    case "InvalidMetadataHash":
      return {
        title: "元数据哈希无效",
        description: "元数据哈希不能为零值。",
      };
    case "NotActivityOwner":
      return {
        title: "所有者权限不足",
        description: "当前钱包不是该活动的所有者。",
      };
    default: {
      const encodedArgs = args.length
        ? `（${args.map((value) => formatArg(value)).join(", ")}）`
        : "";
      return {
        title: "链上交易回滚",
        description: `合约拒绝交易：${error.errorName}${encodedArgs}。`,
      };
    }
  }
}

function getErrorText(error: unknown) {
  if (!(error instanceof Error)) return "";

  if (error instanceof BaseError) {
    return [
      error.shortMessage,
      error.details,
      error.message,
      error.cause instanceof Error ? error.cause.message : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return error.message;
}

export function describeTransactionError(
  error: unknown,
  abi: Abi,
  transactionHash?: Hex,
): TransactionFailure {
  if (error instanceof ChainTransactionError) {
    return {
      title: error.title,
      description: error.message,
    };
  }

  const decoded = decodeContractError(error, abi);
  if (decoded) return describeContractError(decoded);

  const message = getErrorText(error);
  if (
    /user rejected|user denied|rejected the request|request rejected/i.test(message)
  ) {
    return {
      title: "已取消钱包确认",
      description: "你已在钱包中取消签名，本次没有发送链上交易。",
    };
  }

  if (/insufficient funds/i.test(message)) {
    return {
      title: "测试币余额不足",
      description: "当前钱包余额不足以支付 Gas，请充值后重试。",
    };
  }

  if (/timeout|timed out/i.test(message)) {
    return {
      title: "等待链上确认超时",
      description: transactionHash
        ? `交易 ${transactionHash.slice(0, 10)}...${transactionHash.slice(-8)} 可能仍在处理中，请稍后在区块浏览器查询。`
        : "交易可能仍在处理中，请稍后重试。",
    };
  }

  return {
    title: "链上交易失败",
    description: message || "交易未能完成，请检查钱包网络和 Gas 后重试。",
  };
}

async function getRevertFailureFromChain(
  publicClient: PublicClient,
  transactionHash: Hex,
  receipt: TransactionReceipt,
  abi: Abi,
) {
  if (receipt.blockNumber === null) return undefined;

  const transaction = await publicClient.getTransaction({
    hash: transactionHash,
  });
  if (!transaction.to || !transaction.input) return undefined;

  try {
    await publicClient.call({
      account: transaction.from,
      to: transaction.to,
      data: transaction.input,
      value: transaction.value,
      blockNumber:
        receipt.blockNumber > 0n ? receipt.blockNumber - 1n : undefined,
    });
  } catch (error) {
    const decoded = decodeContractError(error, abi);
    if (decoded) return describeContractError(decoded);

    return {
      title: "链上交易回滚",
      description: getErrorText(error) || "交易已上链，但执行被节点回滚。",
    } satisfies TransactionFailure;
  }

  return undefined;
}

export async function waitForSuccessfulTransaction({
  publicClient,
  transactionHash,
  abi,
}: {
  publicClient: PublicClient;
  transactionHash: Hex;
  abi: Abi;
}): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status === "success") return receipt;

  let failure: TransactionFailure | undefined;
  try {
    failure = await getRevertFailureFromChain(
      publicClient,
      transactionHash,
      receipt,
      abi,
    );
  } catch {
    // Fall through to the generic receipt failure if the historical replay is unavailable.
  }

  throw new ChainTransactionError(
    failure ?? {
      title: "链上交易回滚",
      description: "交易已打包，但合约执行失败。请检查权限、密钥代际和照片是否重复。",
    },
    transactionHash,
  );
}
