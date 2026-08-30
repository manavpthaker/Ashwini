import { ProductProvider } from "@/components/product/product-provider";
import { ProductShell } from "@/components/product/product-shell";

export default function ProductLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ProductProvider>
      <ProductShell>{children}</ProductShell>
    </ProductProvider>
  );
}
