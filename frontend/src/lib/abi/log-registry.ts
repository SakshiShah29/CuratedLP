export const logRegistryAbi = [
  {
    name: "getLatestLogs",
    type: "function",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "cid", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "heartbeat", type: "uint256" },
          { name: "decision", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    name: "getLog",
    type: "function",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "cid", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "heartbeat", type: "uint256" },
          { name: "decision", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    name: "logCount",
    type: "function",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;
