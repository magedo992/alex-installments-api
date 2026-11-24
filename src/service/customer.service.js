const { normalizeArabic, toAsciiDigits } = require('../lib/arabic');

function createCustomerService(pool) {
  async function createCustomer(data) {
    const { branch_id, name, phones = [], address = null, risk_level = null, general_note = null } = data;

    if (!branch_id || typeof branch_id !== 'number' || branch_id <= 0) {
      throw new Error('معرف الفرع (branch_id) مطلوب ويجب أن يكون رقماً صحيحاً');
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName || trimmedName.length < 2) {
      throw new Error('اسم العميل مطلوب ولا يقل عن حرفين');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const branchRes = await client.query(
        `UPDATE branches 
         SET last_number = last_number + 1 
         WHERE id = $1 
         RETURNING id, name, code_prefix, last_number`,
        [branch_id]
      );

      if (branchRes.rows.length === 0) {
        throw new Error('الفرع المحدد غير موجود في النظام');
      }

      const branch = branchRes.rows[0];
      const customerCode = String(branch.last_number);
      const normalizedName = normalizeArabic(trimmedName);

      const custRes = await client.query(
        `INSERT INTO customers (customer_code, name, normalized_name, risk_level, general_note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id, customer_code, name, normalized_name, risk_level, general_note, created_at`,
        [customerCode, trimmedName, normalizedName, risk_level, general_note]
      );
      const customer = custRes.rows[0];

      const insertedPhones = [];
      if (Array.isArray(phones) && phones.length > 0) {
        for (let i = 0; i < phones.length; i++) {
          const item = phones[i];
          const rawPhone = typeof item === 'object' && item !== null ? item.phone : item;
          const phoneStr = toAsciiDigits(String(rawPhone || '')).replace(/\s+/g, '');
          
          if (phoneStr) {
            const isPrimary = typeof item === 'object' && item !== null && typeof item.is_primary === 'boolean'
              ? item.is_primary
              : i === 0;
            const label = (typeof item === 'object' && item !== null && item.label) ? String(item.label).trim() : null;

            const phoneRes = await client.query(
              `INSERT INTO phone_numbers (customer_id, phone, is_primary, label, created_at)
               VALUES ($1, $2, $3, $4, NOW())
               RETURNING id, phone, is_primary, label`,
              [customer.id, phoneStr, isPrimary, label]
            );
            insertedPhones.push(phoneRes.rows[0]);
          }
        }
      }

      let insertedAddress = null;
      if (address && typeof address === 'object') {
        const area = address.area ? String(address.area).trim() : null;
        const housingType = address.housing_type ? String(address.housing_type).trim() : null;
        const details = address.address_details ? String(address.address_details).trim() : null;

        if (area || housingType || details) {
          const addrRes = await client.query(
            `INSERT INTO customer_addresses (customer_id, area, housing_type, address_details, is_current, created_at)
             VALUES ($1, $2, $3, $4, TRUE, NOW())
             RETURNING id, area, housing_type, address_details, is_current`,
            [customer.id, area, housingType, details]
          );
          insertedAddress = addrRes.rows[0];
        }
      }

      await client.query('COMMIT');

      return {
        ...customer,
        branch: {
          id: branch.id,
          name: branch.name,
          code_prefix: branch.code_prefix,
        },
        phones: insertedPhones,
        address: insertedAddress,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function searchCustomers({ q, page = 1, limit = 20 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const params = [];

    if (q && typeof q === 'string' && q.trim().length > 0) {
      const cleanQ = q.trim();
      const normalizedQ = normalizeArabic(cleanQ);
      const asciiQ = toAsciiDigits(cleanQ);

      const p1Index = params.length + 1;
      params.push(`%${normalizedQ}%`);
      const p2Index = params.length + 1;
      params.push(`%${cleanQ}%`);
      const p3Index = params.length + 1;
      params.push(`%${asciiQ}%`);

      conditions.push(`(
        c.normalized_name ILIKE $${p1Index} 
        OR c.customer_code ILIKE $${p2Index} 
        OR EXISTS (
          SELECT 1 FROM phone_numbers pn 
          WHERE pn.customer_id = c.id AND pn.phone ILIKE $${p3Index}
        )
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM customers c ${whereClause}`;
    const countRes = await pool.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const dataParams = [...params, limitNum, offset];
    const limitParamIdx = dataParams.length - 1;
    const offsetParamIdx = dataParams.length;

    const dataSql = `
      SELECT 
        c.id,
        c.customer_code,
        c.name,
        c.normalized_name,
        c.risk_level,
        c.general_note,
        c.created_at,
        c.updated_at,
        COALESCE(
          (
            SELECT json_agg(json_build_object(
              'id', pn.id,
              'phone', pn.phone,
              'is_primary', pn.is_primary,
              'label', pn.label
            ) ORDER BY pn.is_primary DESC, pn.id ASC)
            FROM phone_numbers pn
            WHERE pn.customer_id = c.id
          ), '[]'::json
        ) AS phones,
        (
          SELECT json_build_object(
            'id', ca.id,
            'area', ca.area,
            'housing_type', ca.housing_type,
            'address_details', ca.address_details
          )
          FROM customer_addresses ca
          WHERE ca.customer_id = c.id AND ca.is_current = TRUE
          LIMIT 1
        ) AS current_address
      FROM customers c
      ${whereClause}
      ORDER BY c.id DESC
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    `;

    const dataRes = await pool.query(dataSql, dataParams);

    return {
      data: dataRes.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  return {
    createCustomer,
    searchCustomers,
  };
}

module.exports = {
  createCustomerService,
};
