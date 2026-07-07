/**
 * Test Security Fixes - Service Method Signatures
 * Run in browser console after page loads
 */

console.log('🧪 Starting Security Fix Tests...\n');

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: Verify BaseService.update() signature includes orgId
// ═══════════════════════════════════════════════════════════════════════════

console.log('TEST 1: BaseService.update() signature');
console.log('─'.repeat(60));

const testBaseServiceUpdate = () => {
  try {
    // Get BaseService method
    const updateMethod = BaseService.prototype.update;
    const source = updateMethod.toString();

    // Check signature contains orgId parameter
    if (source.includes('orgId') && source.includes('organization_id')) {
      console.log('✅ PASS: update() method has orgId parameter');
      console.log('   - Includes orgId parameter');
      console.log('   - Includes organization_id check in query');
      return true;
    } else {
      console.log('❌ FAIL: update() missing orgId or organization_id check');
      console.log('   Source:', source.substring(0, 200));
      return false;
    }
  } catch (err) {
    console.log('⚠️  ERROR:', err.message);
    return false;
  }
};

const test1Pass = testBaseServiceUpdate();
console.log();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Verify all service methods have correct signatures
// ═══════════════════════════════════════════════════════════════════════════

console.log('TEST 2: Service method signatures');
console.log('─'.repeat(60));

const methodsToCheck = [
  { service: 'Services.folders', method: 'updateFolder', expectedParams: ['folderId', 'orgId', 'payload'] },
  { service: 'Services.tasks', method: 'updateTask', expectedParams: ['taskId', 'orgId', 'payload', 'userId'] },
  { service: 'Services.tasks', method: 'setDone', expectedParams: ['taskId', 'orgId', 'done', 'userId'] },
  { service: 'Services.risks', method: 'updateRiskStatus', expectedParams: ['riskId', 'orgId', 'status', 'userId'] },
  { service: 'Services.counterparties', method: 'saveCounterparty', expectedParams: ['payload', 'orgId'] },
];

const test2Results = [];

methodsToCheck.forEach(({ service, method, expectedParams }) => {
  try {
    // Get the service and method
    const serviceObj = eval(service);
    if (!serviceObj || !serviceObj[method]) {
      console.log(`❌ ${service}.${method} not found`);
      test2Results.push(false);
      return;
    }

    const methodFn = serviceObj[method];
    const source = methodFn.toString();

    // Check all expected parameters are in the signature
    const allFound = expectedParams.every(param => source.includes(param));

    if (allFound) {
      console.log(`✅ ${service}.${method}(${expectedParams.join(', ')})`);
      test2Results.push(true);
    } else {
      console.log(`❌ ${service}.${method} missing parameters`);
      console.log(`   Expected: ${expectedParams.join(', ')}`);
      console.log(`   Source: ${source.substring(0, 150)}`);
      test2Results.push(false);
    }
  } catch (err) {
    console.log(`⚠️  ${service}.${method}: ${err.message}`);
    test2Results.push(false);
  }
});

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Verify currentOrgId is defined
// ═══════════════════════════════════════════════════════════════════════════

console.log('TEST 3: Global state variables');
console.log('─'.repeat(60));

const test3Results = [];

// Check currentOrgId
if (typeof currentOrgId !== 'undefined' && currentOrgId !== null) {
  console.log(`✅ currentOrgId is defined: "${currentOrgId}"`);
  test3Results.push(true);
} else {
  console.log(`⚠️  currentOrgId is ${typeof currentOrgId || 'null'}`);
  console.log('   (This is OK if page just loaded - will be set during init())');
  test3Results.push(false);
}

// Check currentUser
if (typeof currentUser !== 'undefined' && currentUser) {
  console.log(`✅ currentUser is defined: ${currentUser?.email}`);
  test3Results.push(true);
} else {
  console.log(`⚠️  currentUser is ${typeof currentUser || 'null'}`);
  test3Results.push(false);
}

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Verify escapeAttr() function exists
// ═══════════════════════════════════════════════════════════════════════════

console.log('TEST 4: XSS Prevention - escapeAttr() function');
console.log('─'.repeat(60));

const test4Results = [];

if (typeof escapeAttr === 'function') {
  console.log('✅ escapeAttr() function exists');

  // Test the function
  const testCases = [
    { input: "normal-id", expected: "normal-id" },
    { input: "'; alert('xss'); //", expected: "&#39;; alert(&#39;xss&#39;); //" },
    { input: '<img onerror="alert()">', expected: '&lt;img onerror=&quot;alert()&quot;&gt;' },
  ];

  let allTestsPass = true;
  testCases.forEach(({ input, expected }) => {
    const result = escapeAttr(input);
    if (result === expected) {
      console.log(`   ✅ escapeAttr("${input}") correctly escaped`);
    } else {
      console.log(`   ⚠️  escapeAttr("${input}")`);
      console.log(`      Expected: ${expected}`);
      console.log(`      Got:      ${result}`);
      allTestsPass = false;
    }
  });

  test4Results.push(allTestsPass);
} else {
  console.log('❌ escapeAttr() function NOT found');
  test4Results.push(false);
}

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

console.log('═'.repeat(60));
console.log('TEST SUMMARY');
console.log('═'.repeat(60));

const allResults = [test1Pass, ...test2Results, ...test3Results, ...test4Results];
const passCount = allResults.filter(r => r).length;
const totalCount = allResults.length;

console.log(`\n✅ PASSED: ${passCount}/${totalCount} tests\n`);

if (passCount === totalCount) {
  console.log('🎉 All security fixes verified! Ready for testing.');
  console.log('\n📝 Next steps:');
  console.log('   1. Test workflow in UI (create/update/delete operations)');
  console.log('   2. Monitor browser console for errors');
  console.log('   3. Test with Network tab open to verify API calls');
  console.log('   4. Test authorization with incorrect orgId');
} else {
  console.log('⚠️  Some tests failed. Review output above.');
  console.log('   Check that all service method signatures were updated correctly.');
}

console.log('\n' + '═'.repeat(60) + '\n');
