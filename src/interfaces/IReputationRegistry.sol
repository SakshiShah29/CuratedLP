// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IReputationRegistry
/// @notice Minimal interface for the ERC-8004 ReputationRegistry on Base Sepolia.
/// @dev Live at 0x8004B663056A597Dffe9eCcC1965A193B7388713
/// @dev IMPORTANT: Read the actual ABI from BaseScan Sepolia on Day 1 to confirm
///      the exact function signatures. This interface is our best estimate and
///      may need adjustment based on the deployed contract.
interface IReputationRegistry {
    /// @notice Submit reputation feedback for an identity.
    /// @param identityId The ERC-8004 identity token ID.
    /// @param feedback Encoded feedback data.
    function submitFeedback(uint256 identityId, bytes calldata feedback) external;
}