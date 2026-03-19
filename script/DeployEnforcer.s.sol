// SPDX-License-Identifier: MIT
// Must use 0.8.23 to match the delegation-framework's exact-version imports.
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import {CuratedVaultCaveatEnforcer} from "../src/CuratedVaultCaveatEnforcer.sol";

contract DeployEnforcerScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        CuratedVaultCaveatEnforcer enforcer = new CuratedVaultCaveatEnforcer();
        vm.stopBroadcast();

        console.log("CuratedVaultCaveatEnforcer deployed at:", address(enforcer));
        console.log("Set ENFORCER_ADDRESS=%s in agent/.env", address(enforcer));
    }
}
