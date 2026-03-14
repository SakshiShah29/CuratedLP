//SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title VaultShares
/// @notice ERC-20 token representing proportional ownership of the CuratedLP vault.
/// @dev Only the owner (the CuratedVaultHook contract) can mint and burn shares.

contract VaultShares is ERC20{
    address public immutable owner;

    error VaultShares_OnlyOwner();

    modifier onlyOwner(){
        if (msg.sender != owner) revert VaultShares_OnlyOwner();
        _;
    }

     /// @param _owner The CuratedVaultHook contract address.
    constructor(address _owner) ERC20("CuratedLP Vault Shares", "cvLP") {
        owner = _owner;
    }

     /// @notice Mint shares to a depositor. Only callable by the hook.
     function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
     }

     /// @notice Burn shares from a withdrawer. Only callable by the hook.
     function burn(address from,uint256 amount) external onlyOwner {
        _burn(from, amount);
     }
}