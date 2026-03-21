// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LogRegistry
 * @notice On-chain index of CuratedLP agent execution logs stored on Filecoin/IPFS.
 *         Each entry links an ERC-8004 agent ID to a Filecoin CID.
 *         Deployed on Filecoin mainnet (chain 314).
 */
contract LogRegistry {
    struct LogEntry {
        string cid;
        uint256 timestamp;
        uint256 heartbeat;
        string decision;
    }

    /// @notice agentId => array of log entries
    mapping(uint256 => LogEntry[]) public logs;

    /// @notice agentId => total log count
    mapping(uint256 => uint256) public logCount;

    /// @notice Emitted when a new execution log is recorded
    event LogRecorded(
        uint256 indexed agentId,
        uint256 indexed heartbeat,
        string cid,
        string decision,
        uint256 timestamp
    );

    /**
     * @notice Record an execution log CID for an agent.
     * @param agentId   ERC-8004 agent token ID
     * @param cid       IPFS/Filecoin CID of the execution log JSON
     * @param heartbeat Heartbeat cycle number
     * @param decision  Decision taken: "rebalance", "claim_fees", or "skip"
     */
    function recordLog(
        uint256 agentId,
        string calldata cid,
        uint256 heartbeat,
        string calldata decision
    ) external {
        logs[agentId].push(LogEntry({
            cid: cid,
            timestamp: block.timestamp,
            heartbeat: heartbeat,
            decision: decision
        }));
        logCount[agentId]++;

        emit LogRecorded(agentId, heartbeat, cid, decision, block.timestamp);
    }

    /**
     * @notice Get a specific log entry for an agent.
     * @param agentId ERC-8004 agent token ID
     * @param index   Log index (0-based)
     */
    function getLog(uint256 agentId, uint256 index)
        external
        view
        returns (LogEntry memory)
    {
        require(index < logs[agentId].length, "Index out of bounds");
        return logs[agentId][index];
    }

    /**
     * @notice Get the latest N log entries for an agent.
     * @param agentId ERC-8004 agent token ID
     * @param count   Number of entries to return
     */
    function getLatestLogs(uint256 agentId, uint256 count)
        external
        view
        returns (LogEntry[] memory)
    {
        uint256 total = logs[agentId].length;
        if (count > total) count = total;

        LogEntry[] memory result = new LogEntry[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = logs[agentId][total - count + i];
        }
        return result;
    }
}
