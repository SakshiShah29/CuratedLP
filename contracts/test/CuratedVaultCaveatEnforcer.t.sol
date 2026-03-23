// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import { ModeCode } from "@delegator/src/utils/Types.sol";
import { CuratedVaultCaveatEnforcer } from "../src/CuratedVaultCaveatEnforcer.sol";

/// @title CuratedVaultCaveatEnforcerTest
/// @notice Unit tests for the CuratedVaultCaveatEnforcer.
///         Tests call beforeHook() directly — no DelegationManager needed.
contract CuratedVaultCaveatEnforcerTest is Test {

    CuratedVaultCaveatEnforcer enforcer;

    /// @dev Fake hook address used in terms. Any non-zero address works.
    address constant HOOK = address(0xBEEF);

    /// @dev Default terms: hookAddress=HOOK, minFee=500, maxFee=10000, minBlockInterval=10
    uint24 constant MIN_FEE = 500;
    uint24 constant MAX_FEE = 10000;
    uint64 constant MIN_BLOCK_INTERVAL = 10;

    bytes4 constant REBALANCE_SELECTOR = bytes4(keccak256("rebalance(int24,int24,uint24,uint256,uint256)"));
    bytes4 constant CLAIM_FEE_SELECTOR = bytes4(keccak256("claimPerformanceFee()"));

    ModeCode constant MODE = ModeCode.wrap(bytes32(0));
    bytes32 constant DELEGATION_HASH = keccak256("test-delegation");

    function setUp() public {
        enforcer = new CuratedVaultCaveatEnforcer();
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _terms() internal pure returns (bytes memory) {
        return abi.encode(HOOK, MIN_FEE, MAX_FEE, MIN_BLOCK_INTERVAL);
    }

    /// @dev Builds execution calldata: abi.encodePacked(target, value, calldata)
    ///      This is the format DelegationManager passes to beforeHook.
    function _execCalldata(address target, bytes memory cd) internal pure returns (bytes memory) {
        return abi.encodePacked(target, uint256(0), cd);
    }

    function _rebalanceCalldata(int24 tickLower, int24 tickUpper, uint24 fee) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            REBALANCE_SELECTOR,
            tickLower,
            tickUpper,
            fee,
            uint256(0), // maxIdleToken0
            uint256(0)  // maxIdleToken1
        );
    }

    function _claimFeeCalldata() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(CLAIM_FEE_SELECTOR);
    }

    function _callBeforeHook(bytes memory execCalldata) internal {
        enforcer.beforeHook(
            _terms(),
            "",
            MODE,
            execCalldata,
            DELEGATION_HASH,
            address(0),
            address(0)
        );
    }

    function _callBeforeHookWithHash(bytes memory execCalldata, bytes32 delegationHash) internal {
        enforcer.beforeHook(
            _terms(),
            "",
            MODE,
            execCalldata,
            delegationHash,
            address(0),
            address(0)
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //                        rebalance() path
    // ═════════════════════════════════════════════════════════════════

    function test_rebalance_validCallSucceeds() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, 3000);
        _callBeforeHook(_execCalldata(HOOK, cd));
        // No revert = pass
    }

    function test_rebalance_feeAtMinBoundSucceeds() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, MIN_FEE);
        _callBeforeHook(_execCalldata(HOOK, cd));
    }

    function test_rebalance_feeAtMaxBoundSucceeds() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, MAX_FEE);
        _callBeforeHook(_execCalldata(HOOK, cd));
    }

    function test_rebalance_wrongTargetReverts() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, 3000);
        vm.expectRevert(CuratedVaultCaveatEnforcer.InvalidTarget.selector);
        _callBeforeHook(_execCalldata(address(0xDEAD), cd));
    }

    function test_rebalance_wrongSelectorReverts() public {
        bytes memory cd = abi.encodeWithSelector(bytes4(keccak256("unknownFunction()")));
        vm.expectRevert(CuratedVaultCaveatEnforcer.InvalidFunction.selector);
        _callBeforeHook(_execCalldata(HOOK, cd));
    }

    function test_rebalance_feeBelowMinReverts() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, MIN_FEE - 1);
        vm.expectRevert(CuratedVaultCaveatEnforcer.FeeOutOfBounds.selector);
        _callBeforeHook(_execCalldata(HOOK, cd));
    }

    function test_rebalance_feeAboveMaxReverts() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, MAX_FEE + 1);
        vm.expectRevert(CuratedVaultCaveatEnforcer.FeeOutOfBounds.selector);
        _callBeforeHook(_execCalldata(HOOK, cd));
    }

    function test_rebalance_tooFrequentReverts() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, 3000);
        bytes memory exec = _execCalldata(HOOK, cd);

        // First call succeeds (first use, no rate limit)
        _callBeforeHookWithHash(exec, DELEGATION_HASH);

        // Second call in the same block reverts
        vm.expectRevert(CuratedVaultCaveatEnforcer.RebalanceTooFrequent.selector);
        _callBeforeHookWithHash(exec, DELEGATION_HASH);
    }

    function test_rebalance_rateLimitPassesAfterInterval() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, 3000);
        bytes memory exec = _execCalldata(HOOK, cd);

        // First call records block.number
        _callBeforeHookWithHash(exec, DELEGATION_HASH);

        // Advance exactly the minimum block interval
        vm.roll(block.number + MIN_BLOCK_INTERVAL);

        // Should succeed
        _callBeforeHookWithHash(exec, DELEGATION_HASH);
    }

    function test_rebalance_rateLimitOneBlockShortReverts() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, 3000);
        bytes memory exec = _execCalldata(HOOK, cd);

        // First call records block.number
        _callBeforeHookWithHash(exec, DELEGATION_HASH);

        // Advance one block short of the interval
        vm.roll(block.number + MIN_BLOCK_INTERVAL - 1);

        vm.expectRevert(CuratedVaultCaveatEnforcer.RebalanceTooFrequent.selector);
        _callBeforeHookWithHash(exec, DELEGATION_HASH);
    }

    function test_rebalance_rateLimitIsPerDelegationHash() public {
        bytes memory cd = _rebalanceCalldata(-60, 60, 3000);
        bytes memory exec = _execCalldata(HOOK, cd);

        bytes32 hashA = keccak256("delegation-A");
        bytes32 hashB = keccak256("delegation-B");

        // Use delegation A → records block, now rate-limited for hashA
        _callBeforeHookWithHash(exec, hashA);
        vm.expectRevert(CuratedVaultCaveatEnforcer.RebalanceTooFrequent.selector);
        _callBeforeHookWithHash(exec, hashA);

        // Delegation B is independent — still on first use
        _callBeforeHookWithHash(exec, hashB);
    }

    // ═════════════════════════════════════════════════════════════════
    //                      claimPerformanceFee() path
    // ═════════════════════════════════════════════════════════════════

    function test_claimFee_validCallSucceeds() public {
        bytes memory exec = _execCalldata(HOOK, _claimFeeCalldata());
        _callBeforeHook(exec);
    }

    function test_claimFee_wrongTargetReverts() public {
        bytes memory exec = _execCalldata(address(0xDEAD), _claimFeeCalldata());
        vm.expectRevert(CuratedVaultCaveatEnforcer.InvalidTarget.selector);
        _callBeforeHook(exec);
    }

    function test_claimFee_noRateLimiting() public {
        // claimPerformanceFee() has no rate limit — can call any number of times
        bytes memory exec = _execCalldata(HOOK, _claimFeeCalldata());
        _callBeforeHook(exec);
        _callBeforeHook(exec);
        _callBeforeHook(exec);
    }

    function test_claimFee_noFeeCheckApplied() public {
        // claimPerformanceFee() skips fee-bound check entirely.
        // Even with terms that would reject low-fee rebalances, claim still passes.
        bytes memory exec = _execCalldata(HOOK, _claimFeeCalldata());
        _callBeforeHook(exec); // passes regardless of minFee/maxFee in terms
    }

    // ═════════════════════════════════════════════════════════════════
    //                      Terms validation
    // ═════════════════════════════════════════════════════════════════

    function test_shortTermsReverts() public {
        bytes memory shortTerms = abi.encode(HOOK, MIN_FEE); // only 2 fields, < 128 bytes
        bytes memory cd = _rebalanceCalldata(-60, 60, 3000);

        vm.expectRevert(CuratedVaultCaveatEnforcer.InvalidTerms.selector);
        enforcer.beforeHook(shortTerms, "", MODE, _execCalldata(HOOK, cd), DELEGATION_HASH, address(0), address(0));
    }

    // ═════════════════════════════════════════════════════════════════
    //                      Execution calldata validation
    // ═════════════════════════════════════════════════════════════════

    function test_calldataTooShortReverts() public {
        // Fewer than 56 bytes total (20 target + 32 value + 4 min selector)
        bytes memory tooShort = new bytes(40);
        vm.expectRevert(bytes("Calldata too short"));
        enforcer.beforeHook(_terms(), "", MODE, tooShort, DELEGATION_HASH, address(0), address(0));
    }

    // ═════════════════════════════════════════════════════════════════
    //                      Selector constants
    // ═════════════════════════════════════════════════════════════════

    function test_rebalanceSelectorMatchesSignature() public pure {
        assertEq(
            REBALANCE_SELECTOR,
            bytes4(keccak256("rebalance(int24,int24,uint24,uint256,uint256)"))
        );
    }

    function test_claimFeeSelectorMatchesSignature() public pure {
        assertEq(
            CLAIM_FEE_SELECTOR,
            bytes4(keccak256("claimPerformanceFee()"))
        );
    }
}
