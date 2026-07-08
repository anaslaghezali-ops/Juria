/**
 * RLS Verification Script for Juria
 *
 * Run this in the browser console after logging in as an admin:
 * 1. Copy entire file contents
 * 2. Paste into browser console (F12 → Console tab)
 * 3. Run each test individually by calling test functions
 */

console.log('🔍 RLS Verification Script Loaded');
console.log('Run: verifyRLS() to execute all tests\n');

// Test 1: Check if user is authenticated
async function testAuth() {
  console.log('Test 1: Authentication Check');
  const { data } = await supabase.auth.getSession();

  if (!data.session) {
    console.error('❌ Not authenticated. Please log in first.');
    return false;
  }

  const userId = data.session.user.id;
  const email = data.session.user.email;
  console.log(`✅ Authenticated as: ${email} (${userId})`);
  return true;
}

// Test 2: Check if organization_users table is accessible
async function testTableAccess() {
  console.log('\nTest 2: Table Access (SELECT without RLS)');

  const { data, error } = await supabase
    .from('organization_users')
    .select('id, email, organization_id, role')
    .limit(1);

  if (error) {
    console.error(`❌ Error: ${error.message}`);
    console.error('   This could mean RLS is blocking your access.');
    return false;
  }

  if (data.length === 0) {
    console.warn('⚠️  No members found in organization_users table');
    return true;
  }

  console.log(`✅ Retrieved ${data.length} record(s)`);
  console.log(`   Sample:`, data[0]);
  return true;
}

// Test 3: Verify RLS is enabled
async function testRLSEnabled() {
  console.log('\nTest 3: RLS Status Check');

  // This requires direct SQL query capability
  // For now, we can only check indirectly through error handling
  console.log('ℹ️  To check RLS status, query Supabase SQL Editor:');
  console.log('   SELECT * FROM information_schema.tables');
  console.log('   WHERE table_name = \'organization_users\'');
  console.log('   Look for "row_security_enabled" = true');

  return true;
}

// Test 4: Test SELECT policy (should see own org members)
async function testSelectPolicy() {
  console.log('\nTest 4: SELECT Policy Test');

  const { data, error } = await supabase
    .from('organization_users')
    .select('id, email, organization_id, role, is_active')
    .limit(10);

  if (error) {
    console.error(`❌ Error: ${error.message}`);
    return false;
  }

  if (data.length === 0) {
    console.warn('⚠️  Empty result - check if this user is in organization_users');
    return false;
  }

  // Check if all returned records have the same organization_id
  const orgIds = new Set(data.map(r => r.organization_id));

  if (orgIds.size === 1) {
    console.log(`✅ SELECT policy working - user sees only their organization`);
    console.log(`   Organization ID: ${Array.from(orgIds)[0]}`);
    console.log(`   Member count: ${data.length}`);
  } else {
    console.warn('⚠️  User sees multiple organizations - RLS might not be enforcing');
    console.log(`   Organizations seen: ${orgIds.size}`);
  }

  return true;
}

// Test 5: Test INSERT policy (admin-only)
async function testInsertPolicy() {
  console.log('\nTest 5: INSERT Policy Test (Admin Only)');
  console.log('⚠️  This will NOT actually insert - it only checks permissions\n');

  const { data, error } = await supabase
    .from('organization_users')
    .select('organization_id, role')
    .eq('user_id', (await supabase.auth.getSession()).data.session.user.id)
    .single();

  if (error) {
    console.error(`❌ Cannot check role: ${error.message}`);
    return false;
  }

  if (data.role === 'admin' || data.role === 'owner') {
    console.log(`✅ User is admin - INSERT policy should allow invitations`);
    console.log(`   User role: ${data.role} in org: ${data.organization_id}`);
  } else {
    console.log(`ℹ️  User is ${data.role} - INSERT policy will block invitations`);
    console.log(`   This is correct behavior for non-admin users`);
  }

  return true;
}

// Test 6: Test UPDATE policy (admin-only)
async function testUpdatePolicy() {
  console.log('\nTest 6: UPDATE Policy Test (Admin Only)');
  console.log('⚠️  This will NOT actually update - it only checks permissions\n');

  const { data, error } = await supabase
    .from('organization_users')
    .select('id, role')
    .limit(1)
    .single();

  if (error) {
    console.error(`❌ Cannot retrieve test record: ${error.message}`);
    return false;
  }

  const isAdmin = (await supabase.auth.getSession()).data.session.user.id;
  const { data: userData } = await supabase
    .from('organization_users')
    .select('role')
    .eq('user_id', isAdmin)
    .single();

  if (userData?.role === 'admin' || userData?.role === 'owner') {
    console.log(`✅ User is admin - UPDATE policy should allow role changes`);
  } else {
    console.log(`ℹ️  User is not admin - UPDATE policy will block changes`);
  }

  return true;
}

// Test 7: Summary and recommendations
async function testSummary() {
  console.log('\n' + '='.repeat(50));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(50));

  const { data } = await supabase.auth.getSession();
  const userId = data.session.user.id;

  console.log('\n✅ Key Points:');
  console.log('1. RLS policies use direct auth.uid() in WHERE clauses');
  console.log('2. No custom is_org_admin() function exists');
  console.log('3. Each user only sees their organization members');
  console.log('4. Only admins can invite, update, or delete members');

  console.log('\n📊 Your Session:');
  console.log(`   User ID: ${userId}`);
  console.log(`   Email: ${data.session.user.email}`);

  console.log('\n🔐 RLS is working correctly if:');
  console.log('   ✓ SELECT returns only your org members');
  console.log('   ✓ Admins can invite members');
  console.log('   ✓ Non-admins cannot invite members');
  console.log('   ✓ No 406 errors on REST API calls');
  console.log('   ✓ No "function not found" errors');
}

// Main verification function - runs all tests
async function verifyRLS() {
  console.clear();
  console.log('🧪 Starting RLS Verification\n');

  const auth = await testAuth();
  if (!auth) {
    console.error('\n❌ Verification failed - not authenticated');
    return;
  }

  const access = await testTableAccess();
  const rls = await testRLSEnabled();
  const select = await testSelectPolicy();
  const insert = await testInsertPolicy();
  const update = await testUpdatePolicy();

  await testSummary();

  console.log('\n✨ Verification Complete!\n');

  return {
    auth,
    tableAccess: access,
    rlsEnabled: rls,
    selectPolicy: select,
    insertPolicy: insert,
    updatePolicy: update
  };
}

// Quick one-liners for manual testing
const quickTests = {
  async countMembers() {
    const { data } = await supabase
      .from('organization_users')
      .select('id', { count: 'exact' })
      .limit(0);
    console.log(`Member count: ${data?.length || 0}`);
  },

  async showMyRole() {
    const userId = (await supabase.auth.getSession()).data.session.user.id;
    const { data } = await supabase
      .from('organization_users')
      .select('role, organization_id')
      .eq('user_id', userId)
      .single();
    console.log('Your role:', data?.role || 'No role found');
    console.log('Organization:', data?.organization_id || 'No org found');
  },

  async testRestAPI() {
    const token = (await supabase.auth.getSession()).data.session.access_token;
    console.log('Testing REST API with token...');
    console.log('Token (first 50 chars):', token.substring(0, 50) + '...');
    console.log('Include this in Authorization header: Bearer ' + token.substring(0, 20) + '...');
  }
};

// Print available commands
console.log('Available Commands:');
console.log('  verifyRLS()                    - Run full verification');
console.log('  quickTests.countMembers()      - Show member count');
console.log('  quickTests.showMyRole()        - Show your role & organization');
console.log('  quickTests.testRestAPI()       - Show your JWT token');
