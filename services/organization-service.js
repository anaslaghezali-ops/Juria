/**
 * JURIA — OrganizationService
 * Manages organizations and team members
 * Handles user invitations, role management, and license counting
 */

class OrganizationService extends BaseService {
  constructor(supabaseClient, store) {
    super(supabaseClient, 'organization_users', store);
    this._orgTable = 'organizations';
  }

  // ── Organization Management ───────────────────────────────────────────

  /**
   * Get current organization (from user metadata or by querying organization_users)
   * @param {Object} user - auth.users object
   * @returns {Promise<Object|null>}
   */
  async getCurrentOrganization(user) {
    // First try getting from user metadata
    if (user?.user_metadata?.org_id) {
      const { data, error } = await this._sb
        .from(this._orgTable)
        .select('*')
        .eq('id', user.user_metadata.org_id)
        .single();

      if (!error) return data;
    }

    // Fallback: find organization by querying organization_users table
    const { data: memberData, error: memberError } = await this._sb
      .from(this._table)
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (memberError || !memberData?.organization_id) {
      this._handleError('getCurrentOrganization', memberError || new Error('No organization found'));
      return null;
    }

    // Get the organization
    const { data: org, error: orgError } = await this._sb
      .from(this._orgTable)
      .select('*')
      .eq('id', memberData.organization_id)
      .single();

    if (orgError) {
      this._handleError('getCurrentOrganization', orgError);
      return null;
    }

    return org;
  }

  /**
   * Get organization by ID
   * @param {string} orgId
   * @returns {Promise<Object|null>}
   */
  async getOrganizationById(orgId) {
    const { data, error } = await this._sb
      .from(this._orgTable)
      .select('*')
      .eq('id', orgId)
      .single();

    if (error) {
      this._handleError('getOrganizationById', error);
      return null;
    }
    return data;
  }

  /**
   * Create a new organization
   * @param {Object} data - { name, description, max_users }
   * @param {string} userId - Creating user ID
   * @returns {Promise<Object|null>}
   */
  async createOrganization(data, userId) {
    const { name, description, max_users } = data;

    // Build insert data with only required and existing fields
    const insertData = {
      name,
      max_users: max_users || 5,
    };

    // Add optional fields if they exist in schema
    if (description) insertData.description = description;
    if (userId) insertData.created_by = userId;

    const { data: org, error: orgError } = await this._sb
      .from(this._orgTable)
      .insert([insertData])
      .select()
      .single();

    if (orgError) {
      this._handleError('createOrganization', orgError);
      return null;
    }

    // Add creator as admin
    try {
      const user = await this._sb.auth.admin.getUserById(userId);
      await this.addMember(org.id, userId, {
        email: user?.user?.email,
        role: 'admin',
      });
    } catch (err) {
      console.warn('Failed to add creator as admin:', err);
    }

    return org;
  }

  // ── Member Management ─────────────────────────────────────────────────

  /**
   * Get all members of an organization
   * @param {string} orgId
   * @returns {Promise<Array>}
   */
  async getMembers(orgId) {
    const { data, error } = await this._sb
      .from(this._table)
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      this._handleError('getMembers', error);
      return [];
    }
    return data || [];
  }

  /**
   * Get active members count (for license counting)
   * @param {string} orgId
   * @returns {Promise<number>}
   */
  async getActiveMembersCount(orgId) {
    const { data, error } = await this._sb
      .from(this._table)
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (error) {
      this._handleError('getActiveMembersCount', error);
      return 0;
    }
    return (data || []).length;
  }

  /**
   * Check if organization has available licenses
   * @param {string} orgId
   * @returns {Promise<Object>} { canAdd: boolean, activeCount: number, maxUsers: number }
   */
  async checkLicenseAvailability(orgId) {
    const org = await this.getOrganizationById(orgId);
    if (!org) return { canAdd: false, activeCount: 0, maxUsers: 0, error: 'Organization not found' };

    const activeCount = await this.getActiveMembersCount(orgId);
    const canAdd = activeCount < org.max_users;

    return {
      canAdd,
      activeCount,
      maxUsers: org.max_users,
      remaining: Math.max(0, org.max_users - activeCount),
    };
  }

  /**
   * Add a member to the organization
   * @param {string} orgId
   * @param {string} userId
   * @param {Object} data - { email, first_name, last_name, role, invited_by }
   * @returns {Promise<Object|null>}
   */
  async addMember(orgId, userId, data) {
    const { email, first_name, last_name, role = 'member', invited_by } = data;

    // Check license availability
    const license = await this.checkLicenseAvailability(orgId);
    if (!license.canAdd) {
      console.error('License limit reached for org:', orgId);
      throw new Error(`Organization has reached maximum users (${license.maxUsers})`);
    }

    // Build insert object only with fields that exist
    const insertData = {
      organization_id: orgId,
      user_id: userId,
      role: role || 'member',
    };

    // Add optional fields if provided
    if (email) insertData.email = email;
    if (first_name) insertData.first_name = first_name;
    if (last_name) insertData.last_name = last_name;
    if (invited_by) insertData.invited_by = invited_by;

    // is_active and invited_at have defaults in the schema
    insertData.is_active = true;

    const { data: member, error } = await this._sb
      .from(this._table)
      .insert([insertData])
      .select()
      .single();

    if (error) {
      this._handleError('addMember', error);
      return null;
    }
    return member;
  }

  /**
   * Update member info or role
   * @param {string} memberId
   * @param {Object} updates - { first_name, last_name, role, is_active }
   * @returns {Promise<Object|null>}
   */
  async updateMember(memberId, updates) {
    const { data, error } = await this._sb
      .from(this._table)
      .update(updates)
      .eq('id', memberId)
      .select()
      .single();

    if (error) {
      this._handleError('updateMember', error);
      return null;
    }
    return data;
  }

  /**
   * Deactivate member (frees up license)
   * @param {string} memberId
   * @returns {Promise<boolean>}
   */
  async deactivateMember(memberId) {
    const { error } = await this._sb
      .from(this._table)
      .update({ is_active: false })
      .eq('id', memberId);

    if (error) {
      this._handleError('deactivateMember', error);
      return false;
    }
    return true;
  }

  /**
   * Reactivate member (uses license again)
   * @param {string} memberId
   * @returns {Promise<boolean>}
   */
  async reactivateMember(memberId) {
    // Check org license availability first
    const member = await this.getById(memberId);
    if (!member) return false;

    const license = await this.checkLicenseAvailability(member.organization_id);
    if (!license.canAdd) {
      throw new Error(`Organization has reached maximum active users (${license.maxUsers})`);
    }

    const { error } = await this._sb
      .from(this._table)
      .update({ is_active: true })
      .eq('id', memberId);

    if (error) {
      this._handleError('reactivateMember', error);
      return false;
    }
    return true;
  }

  /**
   * Delete member permanently
   * @param {string} memberId
   * @returns {Promise<boolean>}
   */
  async deleteMember(memberId) {
    const { error } = await this._sb
      .from(this._table)
      .delete()
      .eq('id', memberId);

    if (error) {
      this._handleError('deleteMember', error);
      return false;
    }
    return true;
  }

  /**
   * Change member role
   * @param {string} memberId
   * @param {string} newRole - 'admin' | 'member' | 'viewer'
   * @returns {Promise<Object|null>}
   */
  async changeMemberRole(memberId, newRole) {
    if (!['admin', 'member', 'viewer'].includes(newRole)) {
      throw new Error('Invalid role: ' + newRole);
    }

    return this.updateMember(memberId, { role: newRole });
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  /**
   * Update last login timestamp
   * @param {string} orgId
   * @param {string} userId
   * @returns {Promise<void>}
   */
  async updateLastLogin(orgId, userId) {
    try {
      await this._sb.rpc('update_last_login', {
        org_id: orgId,
        user_id: userId,
      });
    } catch (err) {
      console.warn('Failed to update last_login:', err);
    }
  }

  /**
   * Get member by organization and user ID
   * @param {string} orgId
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async getMemberByUserId(orgId, userId) {
    const { data, error } = await this._sb
      .from(this._table)
      .select('*')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      this._handleError('getMemberByUserId', error);
      return null;
    }
    return data;
  }

  /**
   * Check if user is admin of organization
   * @param {string} orgId
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async isAdmin(orgId, userId) {
    const member = await this.getMemberByUserId(orgId, userId);
    // Accept both 'admin' and 'owner' roles as having admin permissions
    return member?.role === 'admin' || member?.role === 'owner';
  }
}
