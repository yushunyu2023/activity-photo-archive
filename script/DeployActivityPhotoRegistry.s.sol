// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ActivityPhotoRegistry} from "../src/ActivityPhotoRegistry.sol";

contract DeployActivityPhotoRegistry is Script {
    function run() external returns (ActivityPhotoRegistry registry) {
        vm.startBroadcast();
        registry = new ActivityPhotoRegistry();
        vm.stopBroadcast();
    }
}
