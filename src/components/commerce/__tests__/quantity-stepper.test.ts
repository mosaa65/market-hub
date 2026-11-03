import assert from "node:assert/strict";
import { cleanAdd, cleanSub } from "../quantity-stepper.js";

console.log("==================================================");
console.log("Starting Cart Quantity Stepper Integer Tests");
console.log("==================================================");

// 1. Basic integer increments
assert.equal(cleanAdd(1, 1), 2, "cleanAdd(1, 1) must equal 2");
assert.equal(cleanAdd(2, 1), 3, "cleanAdd(2, 1) must equal 3");

// 2. Fractional step (like 0.001 from database) must be treated as integer 1
assert.equal(cleanAdd(1, 0.001), 2, "cleanAdd(1, 0.001) must ignore decimal step and add integer 1 => 2");
assert.equal(cleanAdd(2, 0.001), 3, "cleanAdd(2, 0.001) must equal 3");

// 3. Pre-existing decimal quantity (e.g., 1.001 from past bug) must step up to integer
assert.equal(cleanAdd(1.001, 1), 2, "cleanAdd(1.001, 1) must jump to integer 2");
assert.equal(cleanAdd(1.001, 0.001), 2, "cleanAdd(1.001, 0.001) must jump to integer 2");

// 4. Basic integer decrements
assert.equal(cleanSub(3, 1, 1), 2, "cleanSub(3, 1, 1) must equal 2");
assert.equal(cleanSub(2, 1, 1), 1, "cleanSub(2, 1, 1) must equal 1");

// 5. Decreasing 1 must reach 0 to delete the cart item
assert.equal(cleanSub(1, 1, 1), 0, "cleanSub(1, 1, 1) must equal 0 to remove item");
assert.equal(cleanSub(1, 0.001, 0.001), 0, "cleanSub(1, 0.001, 0.001) must return 0 instead of 0.999");
assert.equal(cleanSub(0.999, 1, 1), 0, "cleanSub(0.999, 1, 1) must return 0");

// 6. Pre-existing decimal quantity must step down to integer
assert.equal(cleanSub(2.001, 1, 1), 2, "cleanSub(2.001, 1, 1) must step down to integer 2");
assert.equal(cleanSub(1.5, 1, 1), 1, "cleanSub(1.5, 1, 1) must step down to integer 1");

console.log("✓ All cart quantity stepper integer tests passed successfully!");
console.log("==================================================");
