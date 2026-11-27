import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CreateQuoteRequest } from '@/lib/api';

/**
 * The services counter: pick a customer, collect booking details per
 * service, and turn the lot into a draft quote with tax.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const listServices = vi.fn();
const listCustomers = vi.fn();
const createCustomer = vi.fn();
const createQuote = vi.fn();
vi.mock('@/lib/api', () => ({
  servicesApi: { list: () => listServices() },
  customersApi: { list: () => listCustomers(), create: (b: unknown) => createCustomer(b) },
  quotesApi: { create: (b: unknown) => createQuote(b) },
}));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));

const taxSettings = vi.fn(() => ({ data: { taxRateDefault: 0.08 } }));
vi.mock('@/hooks/queries', () => ({ useSettings: () => taxSettings() }));

const ServicesPos = (await import('../ServicesPos')).default;

// Radix Select reaches for pointer-capture and scrolling APIs jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const SERVICES = [
  { id: 's1', name: 'Sound Engineer', category: 'Audio', description: 'Live mixing', basePrice: 100, unitType: 'hour', isActive: true },
  { id: 's2', name: 'Event Photography', category: 'Media', description: 'Photos', basePrice: 250, unitType: 'event', isActive: true },
  { id: 's3', name: 'Stage Setup', category: 'Logistics', basePrice: undefined, unitType: 'event', isActive: true },
  { id: 's4', name: 'Retired Service', category: 'Audio', basePrice: 10, unitType: 'hour', isActive: false },
];

const CUSTOMERS = [{ id: 'c1', name: 'Grace Church', org: 'Grace', email: 'office@grace.org', phone: '555-0101' }];

const toastTitled = (title: string) => expect.objectContaining({ title });

async function renderServices() {
  render(
    <MemoryRouter>
      <ServicesPos />
    </MemoryRouter>
  );
  await screen.findByText('Services POS');
}

async function addService(name: string, details: Record<string, string> = {}) {
  fireEvent.click(screen.getByText(name));
  const dialog = await screen.findByRole('dialog');
  for (const [label, value] of Object.entries(details)) {
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
  }
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add to Quote' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

function pickCustomer(name: RegExp) {
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('option', { name }), { key: 'Enter' });
}

const total = (label: string) => screen.getByText(label).parentElement;

beforeEach(() => {
  vi.clearAllMocks();
  listServices.mockResolvedValue(SERVICES);
  listCustomers.mockResolvedValue(CUSTOMERS);
  taxSettings.mockReturnValue({ data: { taxRateDefault: 0.08 } });
});

describe('ServicesPos catalogue', () => {
  it('shows a loading state, then only active services', async () => {
    render(
      <MemoryRouter>
        <ServicesPos />
      </MemoryRouter>
    );

    expect(screen.getByText('Loading services...')).toBeInTheDocument();
    await screen.findByText('Sound Engineer');
    expect(screen.queryByText('Retired Service')).not.toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('filters by name or category', async () => {
    await renderServices();
    const search = screen.getByPlaceholderText('Search services...');

    fireEvent.change(search, { target: { value: 'media' } });
    expect(screen.getByText('Event Photography')).toBeInTheDocument();
    expect(screen.queryByText('Sound Engineer')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(screen.getByText('No services available.')).toBeInTheDocument();
  });

  it('reports a failed load and still renders the page', async () => {
    listServices.mockRejectedValue(new Error('Service catalogue offline'));

    await renderServices();

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error loading data', description: 'Service catalogue offline' })
    );
    expect(screen.getByText('No services available.')).toBeInTheDocument();
  });

  it('goes back to the register', async () => {
    await renderServices();

    fireEvent.click(screen.getAllByRole('button')[0]);

    expect(navigate).toHaveBeenCalledWith('/');
  });
});

describe('ServicesPos building a quote', () => {
  it('asks for the fields that suit the service category', async () => {
    await renderServices();

    fireEvent.click(screen.getByText('Sound Engineer'));
    const audio = await screen.findByRole('dialog');
    expect(within(audio).getByLabelText('Expected Attendees')).toBeInTheDocument();
    expect(within(audio).getByLabelText('Special Equipment Needed').tagName).toBe('TEXTAREA');
    fireEvent.click(within(audio).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('Stage Setup'));
    const generic = await screen.findByRole('dialog');
    expect(within(generic).getByLabelText('Location')).toBeInTheDocument();
    expect(within(generic).queryByLabelText('Expected Attendees')).not.toBeInTheDocument();
  });

  it('totals the quote with 8% tax and lists the details collected', async () => {
    await renderServices();

    await addService('Sound Engineer', { Location: 'Main Hall', 'Duration (hours)': '3' });
    await addService('Event Photography', { Deliverables: '50 edited photos' });

    expect(screen.getByText('Quote (2)')).toBeInTheDocument();
    expect(screen.getByText(/Main Hall/)).toBeInTheDocument();
    expect(total('Subtotal')).toHaveTextContent('$350.00');
    expect(total('Tax (8%)')).toHaveTextContent('$28.00');
    expect(total('Total')).toHaveTextContent('$378.00');
  });

  it('prices a service with no base price at zero', async () => {
    await renderServices();

    await addService('Stage Setup');

    expect(total('Subtotal')).toHaveTextContent('$0.00');
  });

  it('shows a $0 base price as a price rather than a stray "0"', async () => {
    listServices.mockResolvedValue([{ ...SERVICES[0], id: 'free', name: 'Free Consult', description: 'Consult desc', basePrice: 0 }]);
    await renderServices();

    const description = await screen.findByText('Consult desc');

    expect(description.parentElement?.textContent).toContain('$0.00');
    expect(description.parentElement?.textContent).not.toContain('Consult desc0');
  });

  it('taxes the quote at the store rate from settings', async () => {
    taxSettings.mockReturnValue({ data: { taxRateDefault: 0.1 } });
    await renderServices();

    await addService('Sound Engineer', { Location: 'Main Hall', 'Duration (hours)': '3' });

    expect(total('Tax (10%)')).toHaveTextContent('$10.00');
    expect(total('Total')).toHaveTextContent('$110.00');
  });

  it('removes a line from the quote', async () => {
    await renderServices();
    await addService('Sound Engineer');

    fireEvent.click(screen.getByRole('button', { name: '×' }));

    expect(screen.getByText('Quote (0)')).toBeInTheDocument();
  });

  it('cannot create a quote without a customer', async () => {
    await renderServices();
    await addService('Sound Engineer');

    expect(screen.getByRole('button', { name: 'Create Quote' })).toBeDisabled();
  });

  it('submits a draft quote for the chosen customer, then clears it', async () => {
    createQuote.mockResolvedValue({ id: 'q1' });
    await renderServices();
    pickCustomer(/Grace Church/);
    expect(await screen.findByText('office@grace.org')).toBeInTheDocument();
    await addService('Sound Engineer', { Location: 'Main Hall' });

    fireEvent.click(screen.getByRole('button', { name: 'Create Quote' }));

    await waitFor(() => expect(createQuote).toHaveBeenCalled());
    const quote = createQuote.mock.calls[0][0] as CreateQuoteRequest;
    expect(quote).toMatchObject({ customerId: 'c1', subtotal: 100, taxTotal: 8, total: 108, status: 'draft' });
    expect(quote.items).toEqual([
      { serviceId: 's1', description: 'Sound Engineer - location: Main Hall', quantity: 1, unitPrice: 100, lineTotal: 100 },
    ]);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Quote created successfully', description: 'Total: $108.00' })
    );
    expect(screen.getByText('Quote (0)')).toBeInTheDocument();
  });

  it('keeps the quote and explains when it cannot be saved', async () => {
    createQuote.mockRejectedValue(new Error('Customer is archived'));
    await renderServices();
    pickCustomer(/Grace Church/);
    await addService('Stage Setup');

    fireEvent.click(screen.getByRole('button', { name: 'Create Quote' }));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error creating quote', description: 'Customer is archived' })
      )
    );
    expect(screen.getByText('Quote (1)')).toBeInTheDocument();
    expect(createQuote.mock.calls[0][0].items[0].description).toBe('Stage Setup');
  });
});

describe('ServicesPos new customer', () => {
  async function submitNewCustomer() {
    fireEvent.click(screen.getByRole('button', { name: /new customer/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Hope Chapel' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'hi@hope.org' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Customer' }));
    return dialog;
  }

  it('creates the customer and selects them for the quote', async () => {
    createCustomer.mockResolvedValue({ id: 'c2', name: 'Hope Chapel', email: 'hi@hope.org' });
    await renderServices();

    await submitNewCustomer();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(toastTitled('Customer created')));
    expect(createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hope Chapel', email: 'hi@hope.org' })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('hi@hope.org')).toBeInTheDocument();
  });

  it('keeps the form open when the customer cannot be created', async () => {
    createCustomer.mockRejectedValue(new Error('Email already in use'));
    await renderServices();

    await submitNewCustomer();

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error creating customer', description: 'Email already in use' })
      )
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('can be cancelled', async () => {
    await renderServices();
    fireEvent.click(screen.getByRole('button', { name: /new customer/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createCustomer).not.toHaveBeenCalled();
  });
});
