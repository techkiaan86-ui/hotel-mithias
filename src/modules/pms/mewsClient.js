/**
 * Official Mews Connector API Client wrapper
 */
export class MewsClient {
  constructor() {
    this.clientToken = process.env.MEWS_CLIENT_TOKEN;
    this.systemAccessToken = process.env.MEWS_ACCESS_TOKEN;
    this.apiUrl = process.env.MEWS_API_URL || 'https://api.mews-demo.com/api/connector/v1';
  }

  /**
   * Helper method to send authenticated POST requests to Mews API
   */
  async _post(path, accessToken, payload = {}) {
    if (!this.clientToken) {
      throw new Error('MEWS_CLIENT_TOKEN environment variable is not configured');
    }

    const token = (accessToken && accessToken.trim()) || this.systemAccessToken;
    if (!token || token.trim().length < 4) {
      throw new Error('Valid Mews AccessToken or property credential is required');
    }

    const endpoint = `${this.apiUrl}${path}`;
    const httpFetch = globalThis.fetch || fetch;

    const response = await httpFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ClientToken: this.clientToken,
        AccessToken: token.trim(),
        ...payload,
      }),
    });

    if (!response.ok) {
      let errorMessage = `Mews API returned HTTP ${response.status}`;
      try {
        const errData = await response.json();
        if (errData && errData.Message) {
          errorMessage = `Mews API Error: ${errData.Message}`;
        }
      } catch {
        // ignore json parse error
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  }

  /**
   * Validates credentials against official Mews Connector API
   * Endpoint: POST /api/connector/v1/enterprises/get
   */
  async validateEnterpriseAccess(tokenOrPropertyId) {
    const data = await this._post('/enterprises/get', tokenOrPropertyId);
    const enterprise = data.Enterprise || (data.Enterprises && data.Enterprises[0]);

    if (!enterprise && !data.Id) {
      throw new Error('Mews API validation failed: Enterprise details not found in response');
    }

    return {
      enterpriseId: enterprise?.Id || data.Id || tokenOrPropertyId,
      enterpriseName: enterprise?.Name || data.Name || 'Mews Enterprise',
      accessTokenUsed: (tokenOrPropertyId && tokenOrPropertyId.trim()) || this.systemAccessToken,
      raw: data,
    };
  }

  /**
   * Fetch Customers/Guests from Mews Connector API
   * Endpoint: POST /api/connector/v1/customers/getAll
   */
  async getCustomers(accessToken, options = {}) {
    const data = await this._post('/customers/getAll', accessToken, {
      Limitation: { Count: options.limit || 100 },
      Extent: { Customers: true, Addresses: true },
      ...options,
    });
    return data.Customers || [];
  }

  /**
   * Fetch Reservations from Mews Connector API
   * Endpoint: POST /api/connector/v1/reservations/getAll
   */
  async getReservations(accessToken, options = {}) {
    const data = await this._post('/reservations/getAll', accessToken, {
      Limitation: { Count: options.limit || 100 },
      Extent: { Reservations: true, Customers: true, Rates: true },
      ...options,
    });
    return data.Reservations || [];
  }

  /**
   * Fetch Resources/Rooms from Mews Connector API
   * Endpoint: POST /api/connector/v1/resources/getAll
   */
  async getResources(accessToken, options = {}) {
    const data = await this._post('/resources/getAll', accessToken, {
      Limitation: { Count: options.limit || 100 },
      Extent: { Resources: true, ResourceCategories: true },
      ...options,
    });
    return data.Resources || [];
  }
}
