// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IIdentityRegistry
/// @notice Minimal interface for the ERC-8004 IdentityRegistry on Base Sepolia.
/// @dev Live at 0x8004A818BFB912233c491871b3d84c89A494BD9e
interface IIdentityRegistry {
    /// @notice Returns the owner of the identity NFT with the given token ID.
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Returns the token balance of an address.
    function balanceOf(address owner) external view returns (uint256);
}