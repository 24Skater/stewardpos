import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageUploadField from '../ImageUploadField';

const upload = vi.fn();
vi.mock('@/lib/api', () => ({ uploadApi: { upload: (kind: string, file: File) => upload(kind, file) } }));

const file = new File(['png'], 'logo.png', { type: 'image/png' });
const pick = () => fireEvent.change(screen.getByLabelText(/upload logo file/i), { target: { files: [file] } });

beforeEach(() => {
  upload.mockReset();
});

describe('ImageUploadField', () => {
  it('uploads the picked file and sets its URL', async () => {
    const onChange = vi.fn();
    upload.mockResolvedValue({ url: '/uploads/logos/abc.png' });
    render(<ImageUploadField id="logo" label="Logo" kind="logo" value="" onChange={onChange} />);

    pick();

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('/uploads/logos/abc.png'));
    expect(upload).toHaveBeenCalledWith('logo', file);
  });

  it('says why an upload failed and keeps the current value', async () => {
    const onChange = vi.fn();
    upload.mockRejectedValue(new Error('File too large'));
    render(<ImageUploadField id="logo" label="Logo" kind="logo" value="/old.png" onChange={onChange} />);

    pick();

    expect(await screen.findByRole('alert')).toHaveTextContent('File too large');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('previews the current image and can clear it', () => {
    const onChange = vi.fn();
    render(<ImageUploadField id="logo" label="Logo" kind="logo" value="/uploads/logos/abc.png" onChange={onChange} />);

    expect(screen.getByAltText('Current logo')).toHaveAttribute('src', '/uploads/logos/abc.png');
    fireEvent.click(screen.getByRole('button', { name: /remove logo/i }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
