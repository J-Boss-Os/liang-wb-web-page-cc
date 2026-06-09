package local.codex;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.FileTemplateResolver;

public final class ThymeleafRenderCheck {
  private static final Pattern CONFIG_KEY_PATTERN =
      Pattern.compile("\"key\"\\s*:\\s*\"([^\"]+)\"");

  private ThymeleafRenderCheck() {}

  public static void main(String[] args) throws Exception {
    String pageDirValue = System.getProperty("pageDir");
    if (pageDirValue == null || pageDirValue.isBlank()) {
      fail("Missing -DpageDir");
    }

    Path pageDir = Path.of(pageDirValue).toAbsolutePath().normalize();
    Path index = pageDir.resolve("index.html");
    if (!Files.isRegularFile(index)) {
      fail("Missing index.html: " + index);
    }

    TemplateEngine engine = new TemplateEngine();
    FileTemplateResolver resolver = new FileTemplateResolver();
    resolver.setPrefix(pageDir.toString() + System.getProperty("file.separator"));
    resolver.setSuffix("");
    resolver.setTemplateMode(TemplateMode.HTML);
    resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
    resolver.setCacheable(false);
    engine.setTemplateResolver(resolver);

    Context context = new Context();
    context.setVariable("ads", "/ads/");
    context.setVariable("baseHref", "/");
    context.setVariable("gaHead", "");
    context.setVariable("gaBody", "");
    for (String key : loadConfigKeys(pageDir.resolve("lp_config.json"))) {
      context.setVariable(key, mockValueFor(key));
    }

    try {
      String rendered = engine.process("index.html", context);
      if (rendered == null || rendered.isBlank()) {
        fail("Rendered output is empty");
      }
      System.out.println("THYMELEAF_RENDER_OK length=" + rendered.length());
    } catch (Exception exc) {
      System.err.println("THYMELEAF_RENDER_FAILED");
      System.err.println(exc.getClass().getName() + ": " + exc.getMessage());
      Throwable cause = exc.getCause();
      int depth = 0;
      while (cause != null && depth < 5) {
        System.err.println("Cause " + (depth + 1) + ": " + cause.getClass().getName() + ": " + cause.getMessage());
        cause = cause.getCause();
        depth++;
      }
      throw exc;
    }
  }

  private static Set<String> loadConfigKeys(Path configPath) throws IOException {
    Set<String> keys = new LinkedHashSet<>();
    if (!Files.isRegularFile(configPath)) {
      return keys;
    }
    String json = Files.readString(configPath, StandardCharsets.UTF_8);
    Matcher matcher = CONFIG_KEY_PATTERN.matcher(json);
    while (matcher.find()) {
      keys.add(matcher.group(1));
    }
    return keys;
  }

  private static String mockValueFor(String key) {
    if (key.endsWith("_image") || key.equals("site_logo")) {
      return "static/mock.png";
    }
    if (key.endsWith("_cta")) {
      return key;
    }
    return "mock-" + key;
  }

  private static void fail(String message) {
    throw new IllegalArgumentException(message);
  }
}
