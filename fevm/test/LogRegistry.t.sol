// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "@forge-std/Test.sol";
import {LogRegistry} from "../src/LogRegistry.sol";

contract LogRegistryTest is Test {
    LogRegistry public registry;

    uint256 constant AGENT_ID = 1;
    string constant CID_1 = "QmTestCid111111111111111111111111111111111111";
    string constant CID_2 = "QmTestCid222222222222222222222222222222222222";
    string constant CID_3 = "QmTestCid333333333333333333333333333333333333";

    function setUp() public {
        registry = new LogRegistry();
    }

    // ── recordLog ───────────────────────────────────────────────

    function test_recordLog_stores_entry() public {
        registry.recordLog(AGENT_ID, CID_1, 42, "rebalance");

        assertEq(registry.logCount(AGENT_ID), 1);

        LogRegistry.LogEntry memory entry = registry.getLog(AGENT_ID, 0);
        assertEq(entry.cid, CID_1);
        assertEq(entry.heartbeat, 42);
        assertEq(entry.timestamp, block.timestamp);
        assertEq(entry.decision, "rebalance");
    }

    function test_recordLog_emits_event() public {
        vm.expectEmit(true, true, false, true);
        emit LogRegistry.LogRecorded(AGENT_ID, 42, CID_1, "rebalance", block.timestamp);

        registry.recordLog(AGENT_ID, CID_1, 42, "rebalance");
    }

    function test_recordLog_increments_count() public {
        registry.recordLog(AGENT_ID, CID_1, 1, "skip");
        registry.recordLog(AGENT_ID, CID_2, 2, "rebalance");
        registry.recordLog(AGENT_ID, CID_3, 3, "claim_fees");

        assertEq(registry.logCount(AGENT_ID), 3);
    }

    // ── getLog ──────────────────────────────────────────────────

    function test_getLog_returns_correct_entry() public {
        registry.recordLog(AGENT_ID, CID_1, 1, "skip");
        registry.recordLog(AGENT_ID, CID_2, 2, "rebalance");

        LogRegistry.LogEntry memory entry = registry.getLog(AGENT_ID, 1);
        assertEq(entry.cid, CID_2);
        assertEq(entry.heartbeat, 2);
        assertEq(entry.decision, "rebalance");
    }

    function test_getLog_reverts_out_of_bounds() public {
        vm.expectRevert("Index out of bounds");
        registry.getLog(AGENT_ID, 0);
    }

    function test_getLog_reverts_past_end() public {
        registry.recordLog(AGENT_ID, CID_1, 1, "skip");

        vm.expectRevert("Index out of bounds");
        registry.getLog(AGENT_ID, 1);
    }

    // ── getLatestLogs ───────────────────────────────────────────

    function test_getLatestLogs_returns_all_when_count_exceeds_total() public {
        registry.recordLog(AGENT_ID, CID_1, 1, "skip");
        registry.recordLog(AGENT_ID, CID_2, 2, "rebalance");

        LogRegistry.LogEntry[] memory entries = registry.getLatestLogs(AGENT_ID, 10);
        assertEq(entries.length, 2);
        assertEq(entries[0].cid, CID_1);
        assertEq(entries[1].cid, CID_2);
    }

    function test_getLatestLogs_returns_last_n() public {
        registry.recordLog(AGENT_ID, CID_1, 1, "skip");
        registry.recordLog(AGENT_ID, CID_2, 2, "rebalance");
        registry.recordLog(AGENT_ID, CID_3, 3, "claim_fees");

        LogRegistry.LogEntry[] memory entries = registry.getLatestLogs(AGENT_ID, 2);
        assertEq(entries.length, 2);
        assertEq(entries[0].cid, CID_2);
        assertEq(entries[0].heartbeat, 2);
        assertEq(entries[1].cid, CID_3);
        assertEq(entries[1].heartbeat, 3);
    }

    function test_getLatestLogs_returns_empty_for_unknown_agent() public {
        LogRegistry.LogEntry[] memory entries = registry.getLatestLogs(999, 5);
        assertEq(entries.length, 0);
    }

    function test_getLatestLogs_returns_empty_when_count_is_zero() public {
        registry.recordLog(AGENT_ID, CID_1, 1, "skip");

        LogRegistry.LogEntry[] memory entries = registry.getLatestLogs(AGENT_ID, 0);
        assertEq(entries.length, 0);
    }

    // ── Agent isolation ─────────────────────────────────────────

    function test_agents_are_isolated() public {
        uint256 agentA = 1;
        uint256 agentB = 2;

        registry.recordLog(agentA, CID_1, 1, "skip");
        registry.recordLog(agentB, CID_2, 1, "rebalance");
        registry.recordLog(agentA, CID_3, 2, "claim_fees");

        assertEq(registry.logCount(agentA), 2);
        assertEq(registry.logCount(agentB), 1);

        LogRegistry.LogEntry memory entryA = registry.getLog(agentA, 0);
        assertEq(entryA.cid, CID_1);

        LogRegistry.LogEntry memory entryB = registry.getLog(agentB, 0);
        assertEq(entryB.cid, CID_2);
    }

    // ── Timestamp ordering ──────────────────────────────────────

    function test_timestamps_increase_with_block_time() public {
        registry.recordLog(AGENT_ID, CID_1, 1, "skip");

        vm.warp(block.timestamp + 30); // Filecoin ~30s blocks

        registry.recordLog(AGENT_ID, CID_2, 2, "rebalance");

        LogRegistry.LogEntry memory first = registry.getLog(AGENT_ID, 0);
        LogRegistry.LogEntry memory second = registry.getLog(AGENT_ID, 1);

        assertGt(second.timestamp, first.timestamp);
        assertEq(second.timestamp - first.timestamp, 30);
    }
}
