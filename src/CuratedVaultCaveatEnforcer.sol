// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { CaveatEnforcer } from "@delegator/src/enforcers/CaveatEnforcer.sol";
import { ModeCode } from "@delegator/src/utils/Types.sol";

/// @title CuratedVaultCaveatEnforcer
/// @notice Restricts delegated rebalance calls to the CuratedVaultHook.
///
/// This enforcer validates FOUR conditions before allowing execution:
///   1. The target address is the CuratedVaultHook contract
///   2. The function being called is rebalance(int24,int24,uint24)
///   3. The fee parameter is within the delegator-specified bounds
///   4. Sufficient blocks have passed since the last rebalance
///
/// Terms encoding (set by delegator at delegation creation time):
///   abi.encode(address hookAddress, uint24 minFee, uint24 maxFee, uint64 minBlockInterval)
///
/// The _executionCalldata received by beforeHook is the FULL execution
/// payload: abi.encodePacked(target, value, calldata). For SINGLE_DEFAULT_MODE
/// (ERC-7579 single execution), the format is:
///   bytes20: target address
///   bytes32: value (uint256)
///   bytes: calldata (4-byte selector + abi-encoded args)
///
/// @dev This contract is compiled with solc 0.8.23 to match the
///      delegation-framework's Solidity version.
contract CuratedVaultCaveatEnforcer is CaveatEnforcer {

    // ─── Errors ──────────────────────────────────────────────────────
    error InvalidTarget();
    error InvalidFunction();
    error FeeOutOfBounds();
    error RebalanceTooFrequent();
    error InvalidTerms();

    // ─── Constants ───────────────────────────────────────────────────
    /// @dev Function selector for: rebalance(int24,int24,uint24)
    bytes4 public constant REBALANCE_SELECTOR = bytes4(keccak256("rebalance(int24,int24,uint24)"));

    // ─── Storage for rate limiting ───────────────────────────────────
    /// @dev delegationHash => last block number this delegation was used
    mapping(bytes32 => uint64) public lastRebalanceBlock;

    // ═════════════════════════════════════════════════════════════════
    //                         beforeHook
    // ═════════════════════════════════════════════════════════════════

    /// @notice Called by the DelegationManager before executing the
    ///         delegated action. Reverts if any condition is not met.
    function beforeHook(
        bytes calldata _terms,
        bytes calldata,          // _args (unused)
        ModeCode,                // _mode (unused)
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address,                 // _delegator (unused)
        address                  // _redeemer (unused)
    ) public override {
        // ── Decode the delegator's terms ─────────────────────────────
        if (_terms.length < 128) revert InvalidTerms(); // 4 * 32 bytes minimum

        (
            address hookAddress,
            uint24 minFee,
            uint24 maxFee,
            uint64 minBlockInterval
        ) = abi.decode(_terms, (address, uint24, uint24, uint64));

        // ── Extract target and calldata from execution payload ───────
        // CRITICAL: The DelegationManager uses ExecutionLib.encodeSingle()
        // which is abi.encodePacked(target, value, callData):
        //   bytes 0-19:   target address (20 bytes, NO padding)
        //   bytes 20-51:  value (uint256, 32 bytes)
        //   bytes 52+:    raw callData (variable length, NO length prefix)
        //
        // This is NOT abi.encode format. Do NOT use abi.decode here.

        require(_executionCalldata.length >= 56, "Calldata too short");
        // 20 (target) + 32 (value) + 4 (min selector) = 56 bytes minimum

        // Extract target: first 20 bytes
        address target = address(bytes20(_executionCalldata[0:20]));

        // Skip value (bytes 20-51), extract callData (bytes 52+)
        bytes calldata callData = _executionCalldata[52:];

        // ── Check 1: Target is the hook ──────────────────────────────
        if (target != hookAddress) revert InvalidTarget();

        // ── Check 2: Function is rebalance ───────────────────────────
        require(callData.length >= 4, "No selector");
        bytes4 selector = bytes4(callData[0:4]);
        if (selector != REBALANCE_SELECTOR) revert InvalidFunction();

        // ── Check 3: Fee is within bounds ────────────────────────────
        // rebalance(int24 newTickLower, int24 newTickUpper, uint24 newFee)
        // After the 4-byte selector, the args are ABI-encoded:
        //   int24 newTickLower (padded to 32 bytes)
        //   int24 newTickUpper (padded to 32 bytes)
        //   uint24 newFee (padded to 32 bytes)
        // Total: 4 + 96 = 100 bytes
        require(callData.length >= 100, "Calldata incomplete");

        (, , uint24 newFee) = abi.decode(
            callData[4:],
            (int24, int24, uint24)
        );

        if (newFee < minFee || newFee > maxFee) revert FeeOutOfBounds();

        // ── Check 4: Rate limiting ───────────────────────────────────
        if (uint64(block.number) < lastRebalanceBlock[_delegationHash] + minBlockInterval) {
            revert RebalanceTooFrequent();
        }
        lastRebalanceBlock[_delegationHash] = uint64(block.number);
    }

    // ═════════════════════════════════════════════════════════════════
    //                         afterHook
    // ═════════════════════════════════════════════════════════════════

    /// @notice No-op. All checks happen in beforeHook.
    function afterHook(
        bytes calldata,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) public override {
        // Nothing to do post-execution.
    }
}